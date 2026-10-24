#include "streaming_runtime.h"
#include "caption_output.h"
#include "pcm_frames.h"
#include "streaming_input.h"
#include "streaming_recognizer.h"
#include "streaming_decoder.h"
#include "whisper.h"
#include <iostream>
#include <thread>

int run_streaming(const StreamingRecognizerConfig &model, const char *vad_file, const InferenceConfig &config) {
    using Clock = std::chrono::steady_clock;
    const auto elapsed = [](Clock::time_point start) {
        return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
    };
    std::unique_ptr<StreamingRecognizer> recognizer;
    whisper_log_set([](enum ggml_log_level, const char *, void *) {}, nullptr);
    try {
        phase("loading-streaming-asr-cpu");
        recognizer = std::make_unique<StreamingRecognizer>(model);
    } catch (const std::exception &) {
        emit({{"type", "error"}, {"code", "modelInvalid"}});
        return 3;
    }
    phase("loading-vad-cpu");
    auto vad_config = whisper_vad_default_context_params();
    vad_config.use_gpu = false;
    vad_config.n_threads = 1;
    auto vad = std::unique_ptr<whisper_vad_context, decltype(&whisper_vad_free)>(
        whisper_vad_init_from_file_with_params(vad_file, vad_config), whisper_vad_free);
    if (!vad) {
        emit({{"type", "error"}, {"code", "modelInvalid"}});
        return 3;
    }
    StreamingInputQueue queue(StreamingSegmenter::max_samples + 512);
    std::atomic<bool> decoder_failed{false};
    std::thread decoder([&] {
        StreamingDecoder state(*recognizer, [](auto sequence, auto start, auto end, bool final, const auto &text) {
            emit({{"type", final ? "final" : "partial"}, {"sequence", sequence},
                  {"startMs", start}, {"endMs", end}, {"english", text}});
        });
        try {
            while (auto job = queue.take()) {
                const double queue_ms = elapsed(job->queued_at);
                const auto began = Clock::now();
                state.consume(*job);
                if (config.diagnostics) metric({
                    {"stage", job->final ? "final" : "partial"}, {"queueMs", queue_ms},
                    {"computeMs", elapsed(began)}, {"audioMs", job->samples.size() * 1000.0 / 16000},
                    {"cancelled", false}, {"result", 0}});
            }
            state.close();
        } catch (const std::exception &) {
            decoder_failed.store(true);
            queue.abort();
            state.close();
            emit({{"type", "error"}, {"code", "engineFailed"}});
        }
    });
    StreamingSegmenter segmenter([&](RecognitionJob job) { return !decoder_failed.load() && queue.submit(std::move(job)); });
    int result = 0;
    phase("ready");
    emit({{"type", "ready"}, {"protocol", 1}, {"backend", "cpu"}});
    try {
        const bool complete = read_pcm_frames(std::cin, [&](const float *frame, size_t count, PcmPosition position) {
            if (decoder_failed.load()) return false;
            if (!whisper_vad_detect_speech_no_reset(vad.get(), frame, 512))
                throw std::runtime_error("VAD inference failed");
            const auto n = whisper_vad_n_probs(vad.get());
            const bool talking = n > 0 && whisper_vad_probs(vad.get())[n - 1] >= 0.5f;
            return segmenter.accept(frame, count, position, talking);
        });
        if (!complete || !segmenter.finish()) {
            result = decoder_failed.load() ? 6 : 7;
            if (result == 7) emit({{"type", "error"}, {"code", "audioBacklog"}});
        }
    } catch (const std::invalid_argument &) {
        result = 4;
    } catch (const std::exception &) {
        result = 5;
        emit({{"type", "error"}, {"code", "engineFailed"}});
    }
    // Admission failure must not suppress already accepted completed utterances.
    if ((result == 0 || result == 7) && !decoder_failed.load()) queue.close();
    else queue.abort();
    decoder.join();
    if (decoder_failed.load()) return 6;
    if (result != 0) return result;
    phase("stopped");
    emit({{"type", "stopped"}});
    return 0;
}
