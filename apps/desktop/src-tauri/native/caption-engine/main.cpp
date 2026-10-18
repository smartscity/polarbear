#include "whisper.h"
#include "json.hpp"
#include "recognition_queue.h"
#include "inference_config.h"
#include "preview_schedule.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <thread>
#include <vector>

using json = nlohmann::ordered_json;
using Clock = std::chrono::steady_clock;
static double milliseconds(Clock::time_point from) {
    return std::chrono::duration<double, std::milli>(Clock::now() - from).count();
}
constexpr int sample_rate = 16000;
constexpr int frame_samples = 512;
constexpr int max_samples = sample_rate * 15;

static std::mutex output_mutex;
static void emit(const json &event) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cout << event.dump() << '\n' << std::flush;
}
static void phase(const char *name) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cerr << "caption-phase:" << name << '\n' << std::flush;
}
static void metric(const json &value) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cerr << "caption-metric:" << value.dump() << '\n' << std::flush;
}
static bool read_exact(char *target, size_t count) {
    std::cin.read(target, static_cast<std::streamsize>(count));
    return static_cast<size_t>(std::cin.gcount()) == count;
}
static uint64_t little(const unsigned char *data, size_t count) {
    uint64_t result = 0;
    for (size_t i=0; i<count; ++i) result |= uint64_t(data[i]) << (8*i);
    return result;
}

static int read_pcm(whisper_vad_context *vad, RecognitionQueue &queue,
                    const std::atomic<bool> &inference_failed, bool diagnostics) {
    std::vector<float> speech, carry, preroll;
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
    unsigned char header[12];
    while (read_exact(reinterpret_cast<char *>(header), sizeof(header))) {
        if (inference_failed.load()) return 6;
        const auto timestamp = little(header,8);
        const auto count = little(header+8,4);
        if (count>4096 || count==0) return 4;
        std::vector<float> input(count);
        if (!read_exact(reinterpret_cast<char *>(input.data()), count*sizeof(float))) return 4;
        for (float sample:input) if (!std::isfinite(sample) || std::abs(sample)>2.0f) return 4;
        carry.insert(carry.end(),input.begin(),input.end());
        while (carry.size()>=frame_samples) {
            const auto vad_started = Clock::now();
            if (!whisper_vad_detect_speech_no_reset(vad,carry.data(),frame_samples)) return 5;
            vad_ms += milliseconds(vad_started);
            if (++frames % 100 == 0 && diagnostics) metric({{"stage","vad"},{"frames",frames},{"computeMs",vad_ms}});
            const int n = whisper_vad_n_probs(vad);
            const bool talking = n>0 && whisper_vad_probs(vad)[n-1] >= 0.5f;
            end = timestamp + count*1000/sample_rate;
            if (talking && speech.empty()) {
                start = timestamp > preroll.size()*1000/sample_rate ? timestamp-preroll.size()*1000/sample_rate : 0;
                speech = preroll;
                quiet = 0;
                previews.reset();
            }
            if (!speech.empty() || talking) {
                speech.insert(speech.end(),carry.begin(),carry.begin()+frame_samples);
                quiet = talking ? 0 : quiet+frame_samples;
                bool final = quiet>=sample_rate*3/5 || speech.size()>=max_samples;
                if (final) {
                    if (const int result = finalize()) return result;
                } else if (previews.due(speech.size())) {
                    previews.attempted(speech.size(), queue.offer_partial(speech, sequence, start, end));
                }
                if (final) { speech.clear(); quiet=0; previews.reset(); preroll.clear(); }
            } else {
                preroll.insert(preroll.end(),carry.begin(),carry.begin()+frame_samples);
                if (preroll.size()>sample_rate/5) preroll.erase(preroll.begin(),preroll.end()-sample_rate/5);
            }
            carry.erase(carry.begin(),carry.begin()+frame_samples);
        }
    }
    if (!std::cin.eof() || std::cin.gcount() != 0) return 4;
    return finalize();
}

int main(int argc, char **argv) {
    const auto cores = std::thread::hardware_concurrency();
    const auto config = inference_config(argc, argv, cores);
    if (!config) return 2;
    if (config->diagnostics) metric({{"stage","config"},{"availableCpus",cores},{"threads",config->threads}});
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
    auto recognize = [&](const RecognitionJob &job) {
        abort_context.final = job.final;
        phase(job.final ? "recognizing-final" : "recognizing-partial");
        const double queue_ms = milliseconds(job.queued_at);
        const auto began = Clock::now();
        const int result = whisper_full(context.get(), params, job.samples.data(), static_cast<int>(job.samples.size()));
        if (config->diagnostics) metric({{"stage",job.final ? "final" : "partial"},
            {"audioMs",job.samples.size()*1000.0/sample_rate},{"queueMs",queue_ms},
            {"computeMs",milliseconds(began)},{"cancelled",queue.cancelled(job.final)},{"result",result}});
        if (queue.cancelled(job.final)) return true;
        if (result != 0) return false;
        std::string text;
        for (int i=0; i<whisper_full_n_segments(context.get()); ++i) {
            if (whisper_full_get_segment_no_speech_prob(context.get(), i) < 0.6f)
                text += whisper_full_get_segment_text(context.get(), i);
        }
        if (text.find_first_not_of(" \n\t") == std::string::npos) return true;
        if (text.size()>16384) return false;
        emit({{"type",job.final ? "final" : "partial"}, {"sequence",job.sequence},
              {"startMs",job.start_ms}, {"endMs",job.end_ms}, {"english",text}});
        return true;
    };
    std::thread decoder([&] {
        while (auto job = queue.take()) {
            if (!recognize(*job)) {
                inference_failed.store(true);
                emit({{"type","error"},{"code","engineFailed"}});
                queue.abort();
                return;
            }
            queue.complete();
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
}
