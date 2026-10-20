#include "streaming_runtime.h"
#include "caption_output.h"
#include "pcm_frames.h"
#include "streaming_input.h"
#include "streaming_recognizer.h"
#include "whisper.h"
#include <filesystem>
#include <iostream>
#include <thread>

int run_streaming(const char *model_directory, const char *vad_file, const InferenceConfig &config) {
    using Clock = std::chrono::steady_clock;
    const auto elapsed = [](Clock::time_point start) {
        return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
    };
    const auto directory = std::filesystem::path(model_directory);
    std::unique_ptr<StreamingRecognizer> recognizer;
    whisper_log_set([](enum ggml_log_level, const char *, void *) {}, nullptr);
    try {
        phase("loading-streaming-asr-cpu");
        recognizer = std::make_unique<StreamingRecognizer>(StreamingRecognizerConfig{
            (directory / "encoder-epoch-99-avg-1.onnx").string(),
            (directory / "decoder-epoch-99-avg-1.onnx").string(),
            (directory / "joiner-epoch-99-avg-1.onnx").string(),
            (directory / "tokens.txt").string(), config.threads});
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
    std::atomic<bool> failed{false};
    std::thread decoder([&] {
        uint64_t sequence = 0, closed_sequence = 0, start = 0, end = 0;
        try {
            while (auto job = queue.take()) {
                if (sequence == 0) {
                    if (job->sequence <= closed_sequence) throw std::logic_error("Replayed streaming sequence");
                    recognizer->begin();
                    sequence = job->sequence;
                    start = job->start_ms;
                    end = start;
                }
                if (job->sequence != sequence || job->start_ms != start || job->end_ms < end)
                    throw std::logic_error("Out-of-order streaming audio");
                end = job->end_ms;
                const double queue_ms = elapsed(job->queued_at);
                const auto began = Clock::now();
                auto text = recognizer->accept(job->samples.data(), job->samples.size());
                if (job->final) text = recognizer->finish();
                if (config.diagnostics) metric({
                    {"stage", job->final ? "final" : "partial"}, {"queueMs", queue_ms},
                    {"computeMs", elapsed(began)}, {"audioMs", job->samples.size() * 1000.0 / 16000},
                    {"cancelled", false}, {"result", 0}});
                if (!failed.load() && text && text->find_first_not_of(" \t\r\n") != std::string::npos)
                    emit({{"type", job->final ? "final" : "partial"}, {"sequence", sequence},
                          {"startMs", start}, {"endMs", end}, {"english", *text}});
                if (job->final) { closed_sequence = sequence; sequence = 0; }
            }
            recognizer->abort();
        } catch (const std::exception &) {
            if (!failed.exchange(true)) emit({{"type", "error"}, {"code", "engineFailed"}});
            queue.abort();
            recognizer->abort();
        }
    });
    StreamingSegmenter segmenter([&](RecognitionJob job) { return !failed.load() && queue.submit(std::move(job)); });
    int result = 0;
    phase("ready");
    emit({{"type", "ready"}, {"protocol", 1}, {"backend", "cpu"}});
    try {
        const bool complete = read_pcm_frames(std::cin, [&](const float *frame, size_t count, uint64_t timestamp) {
            if (failed.load()) return false;
            if (!whisper_vad_detect_speech_no_reset(vad.get(), frame, 512))
                throw std::runtime_error("VAD inference failed");
            const auto n = whisper_vad_n_probs(vad.get());
            const bool talking = n > 0 && whisper_vad_probs(vad.get())[n - 1] >= 0.5f;
            return segmenter.accept(frame, count, timestamp, talking);
        });
        if (!complete || !segmenter.finish()) {
            result = 7;
            if (!failed.exchange(true)) emit({{"type", "error"}, {"code", "audioBacklog"}});
        }
    } catch (const std::invalid_argument &) {
        result = 4;
        failed.store(true);
    } catch (const std::exception &) {
        result = 5;
        if (!failed.exchange(true)) emit({{"type", "error"}, {"code", "engineFailed"}});
    }
    if (result == 0 && !failed.load()) queue.close();
    else queue.abort();
    decoder.join();
    if (failed.load()) return result ? result : 6;
    phase("stopped");
    emit({{"type", "stopped"}});
    return 0;
}
