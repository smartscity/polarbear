#include "whisper.h"
#include "caption_output.h"
#include "recognition_queue.h"
#include "inference_config.h"
#include "preview_schedule.h"
#include "pcm_frames.h"
#ifdef POLARBEAR_STREAMING_CANDIDATE
#include "streaming_runtime.h"
#endif
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <thread>
#include <vector>

using json = nlohmann::ordered_json;
#ifndef POLARBEAR_STREAMING_CANDIDATE
using Clock = std::chrono::steady_clock;
static double milliseconds(Clock::time_point from) {
    return std::chrono::duration<double, std::milli>(Clock::now() - from).count();
}
constexpr int sample_rate = 16000;
constexpr int frame_samples = 512;
constexpr int max_samples = sample_rate * 15;
#endif

static std::mutex output_mutex;
void emit(const json &event) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cout << event.dump() << '\n' << std::flush;
}
void phase(const char *name) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cerr << "caption-phase:" << name << '\n' << std::flush;
}
void metric(const json &value) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cerr << "caption-metric:" << value.dump() << '\n' << std::flush;
}
#ifndef POLARBEAR_STREAMING_CANDIDATE
static int read_pcm(whisper_vad_context *vad, RecognitionQueue &queue,
                    const std::atomic<bool> &inference_failed, bool diagnostics) {
    std::vector<float> speech, preroll;
    uint64_t start = 0, end = 0, sequence = 1;
    int quiet = 0;
    PreviewSchedule previews(sample_rate);
    double vad_ms = 0;
    uint64_t frames = 0;
    auto finalize = [&]() -> int {
        if (inference_failed.load()) return 6;
        if (speech.size() < size_t(sample_rate / 3)) return 0;
        if (queue.submit_final({std::move(speech), sequence++, start, end, true})) return 0;
        if (inference_failed.load()) return 6;
        emit({{"type","error"},{"code","audioBacklog"}});
        return 7;
    };
    int failure = 0;
    try {
        read_pcm_frames(std::cin, [&](const float *frame, size_t count, PcmPosition position) {
            if (inference_failed.load()) { failure = 6; return false; }
            const auto vad_started = Clock::now();
            if (!whisper_vad_detect_speech_no_reset(vad,frame,frame_samples)) { failure = 5; return false; }
            vad_ms += milliseconds(vad_started);
            if (++frames % 100 == 0 && diagnostics) metric({{"stage","vad"},{"frames",frames},{"computeMs",vad_ms}});
            const int n = whisper_vad_n_probs(vad);
            const bool talking = n>0 && whisper_vad_probs(vad)[n-1] >= 0.5f;
            end = position.advanced(count).milliseconds();
            if (talking && speech.empty()) {
                start = position.preceding(preroll.size()).milliseconds();
                speech = preroll;
                quiet = 0;
                previews.reset();
            }
            if (!speech.empty() || talking) {
                speech.insert(speech.end(),frame,frame+count);
                quiet = talking ? 0 : quiet+count;
                if (queue.consume_empty_preview(sequence)) previews.retry_empty(speech.size());
                bool final = quiet>=sample_rate*3/5 || speech.size()>=max_samples;
                if (final) {
                    if ((failure = finalize())) return false;
                } else if (previews.due(speech.size())) {
                    previews.attempted(speech.size(), queue.offer_partial(speech, sequence, start, end));
                }
                if (final) { speech.clear(); quiet=0; previews.reset(); preroll.clear(); }
            } else {
                preroll.insert(preroll.end(),frame,frame+count);
                if (preroll.size()>sample_rate/5) preroll.erase(preroll.begin(),preroll.end()-sample_rate/5);
            }
            return true;
        });
    } catch (const std::invalid_argument &) {
        return 4;
    }
    if (failure) return failure;
    return finalize();
}
#endif

int main(int argc, char **argv) {
    const auto cores = std::thread::hardware_concurrency();
#ifdef POLARBEAR_STREAMING_CANDIDATE
    const auto config = inference_config(argc, argv, cores, 6);
#else
    const auto config = inference_config(argc, argv, cores);
#endif
    if (!config) return 2;
    if (config->diagnostics) metric({{"stage","config"},{"availableCpus",cores},{"threads",config->threads}});
#ifdef POLARBEAR_STREAMING_CANDIDATE
    return run_streaming({argv[1], argv[2], argv[3], argv[4], config->threads}, argv[5], *config);
#else
    whisper_log_set([](enum ggml_log_level, const char *, void *) {}, nullptr);
    auto context_params = whisper_context_default_params();
    // Keep the production and fixture paths identical until Metal is qualified.
    context_params.use_gpu = false;
    phase("loading-asr-cpu");
    auto context = std::unique_ptr<whisper_context, decltype(&whisper_free)>(
        whisper_init_from_file_with_params(argv[1], context_params), whisper_free);
    auto vad_params = whisper_vad_default_context_params();
    vad_params.use_gpu = false;
    vad_params.n_threads = 1;
    phase("loading-vad-cpu");
    auto vad = std::unique_ptr<whisper_vad_context, decltype(&whisper_vad_free)>(
        whisper_vad_init_from_file_with_params(argv[2], vad_params), whisper_vad_free);
    if (!context || !vad) { emit({{"type","error"},{"code","modelInvalid"}}); return 3; }
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = config->threads;
    params.language = "en";
    params.translate = false;
    params.no_context = true;
    params.print_realtime = params.print_progress = params.print_timestamps = params.print_special = false;
    params.temperature_inc = 0;
    params.suppress_nst = true;
    // Bound queued finalized PCM to one maximum utterance, in addition to one in flight.
    // Capture/VAD never waits for inference, and busy inference never queues partials.
    RecognitionQueue queue(max_samples + frame_samples);
    std::atomic<bool> inference_failed{false};
    struct AbortContext { RecognitionQueue &queue; bool final; } abort_context{queue, false};
    params.abort_callback = [](void *data) {
        auto &state = *static_cast<AbortContext *>(data);
        return state.queue.cancelled(state.final);
    };
    params.abort_callback_user_data = &abort_context;
    auto recognize = [&](const RecognitionJob &job, bool &text_emitted) {
        abort_context.final = job.final;
        phase(job.final ? "recognizing-final" : "recognizing-partial");
        const double queue_ms = milliseconds(job.queued_at);
        const auto began = Clock::now();
        const int result = whisper_full(context.get(), params, job.samples.data(), static_cast<int>(job.samples.size()));
        const double compute_ms = milliseconds(began);
        const bool cancelled = queue.cancelled(job.final);
        auto report = [&](bool emitted) {
            if (config->diagnostics) metric({{"stage",job.final ? "final" : "partial"},
                {"sequence",job.sequence},{"startMs",job.start_ms},{"endMs",job.end_ms},
                {"audioMs",job.samples.size()*1000.0/sample_rate},{"queueMs",queue_ms},
                {"computeMs",compute_ms},{"cancelled",cancelled},{"result",result},{"textEmitted",emitted}});
        };
        if (cancelled) { report(false); return true; }
        if (result != 0) { report(false); return false; }
        std::string text;
        for (int i=0; i<whisper_full_n_segments(context.get()); ++i) {
            if (whisper_full_get_segment_no_speech_prob(context.get(), i) < 0.6f)
                text += whisper_full_get_segment_text(context.get(), i);
        }
        if (text.find_first_not_of(" \n\t") == std::string::npos) {
            if (job.final) emit({{"type","partial"}, {"sequence",job.sequence},
                {"startMs",job.start_ms}, {"endMs",job.end_ms}, {"english",""}});
            report(false);
            return true;
        }
        if (text.size()>16384) { report(false); return false; }
        emit({{"type",job.final ? "final" : "partial"}, {"sequence",job.sequence},
              {"startMs",job.start_ms}, {"endMs",job.end_ms}, {"english",text}});
        report(true);
        text_emitted = true;
        return true;
    };
    std::thread decoder([&] {
        while (auto job = queue.take()) {
            bool text_emitted = false;
            if (!recognize(*job, text_emitted)) {
                inference_failed.store(true);
                emit({{"type","error"},{"code","engineFailed"}});
                queue.abort();
                return;
            }
            queue.complete(text_emitted);
        }
    });
    phase("ready");
    emit({{"type","ready"},{"protocol",1},{"backend","cpu"}});
    const int result = read_pcm(vad.get(), queue, inference_failed, config->diagnostics);
    // On overload, preserve accepted finals; malformed input or inference failure aborts.
    if (result == 0 || result == 7) queue.close();
    else queue.abort();
    decoder.join();
    if (inference_failed.load()) return 6;
    if (result != 0) return result;
    phase("stopped");
    emit({{"type","stopped"}});
    return 0;
#endif
}
