#include "whisper.h"
#include "json.hpp"
#include "recognition_queue.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <thread>
#include <vector>

using json = nlohmann::ordered_json;
constexpr int sample_rate = 16000;
constexpr int frame_samples = 512;
constexpr int max_samples = sample_rate * 15;

static std::mutex output_mutex;
static void emit(const json &event) {
    std::lock_guard<std::mutex> lock(output_mutex);
    std::cout << event.dump() << '\n' << std::flush;
}
static void phase(const char *name) { std::cerr << "caption-phase:" << name << '\n' << std::flush; }
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
                    const std::atomic<bool> &inference_failed) {
    std::vector<float> speech, carry, preroll;
    uint64_t start = 0, end = 0, sequence = 1;
    int quiet = 0, last_partial = 0;
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
            if (!whisper_vad_detect_speech_no_reset(vad,carry.data(),frame_samples)) return 5;
            const int n = whisper_vad_n_probs(vad);
            const bool talking = n>0 && whisper_vad_probs(vad)[n-1] >= 0.5f;
            end = timestamp + count*1000/sample_rate;
            if (talking && speech.empty()) {
                start = timestamp > preroll.size()*1000/sample_rate ? timestamp-preroll.size()*1000/sample_rate : 0;
                speech = preroll;
                quiet = last_partial = 0;
            }
            if (!speech.empty() || talking) {
                speech.insert(speech.end(),carry.begin(),carry.begin()+frame_samples);
                quiet = talking ? 0 : quiet+frame_samples;
                bool final = quiet>=sample_rate*3/5 || speech.size()>=max_samples;
                if (final) {
                    if (const int result = finalize()) return result;
                } else if (int(speech.size())-last_partial>=sample_rate*2) {
                    queue.offer_partial(speech, sequence, start, end);
                    last_partial = static_cast<int>(speech.size());
                }
                if (final) { speech.clear(); quiet=last_partial=0; preroll.clear(); }
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
    if (argc != 3) return 2;
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
    params.n_threads = 4;
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
        const int result = whisper_full(context.get(), params, job.samples.data(), static_cast<int>(job.samples.size()));
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
    const int result = read_pcm(vad.get(), queue, inference_failed);
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
