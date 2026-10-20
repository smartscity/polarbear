#include "streaming_recognizer.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <utility>

namespace {
constexpr int32_t sample_rate = 16000;
constexpr std::size_t max_samples = sample_rate * 15;
// Match sherpa-onnx's pinned online-decode-files.py transducer EOF padding.
constexpr std::size_t lookahead_samples = sample_rate * 66 / 100;
constexpr std::size_t max_text_bytes = 16384;

void validate_path(const std::string &path) {
    if (path.empty() || path.find('\0') != std::string::npos) {
        throw std::invalid_argument("Streaming model paths must be nonempty and contain no NUL bytes");
    }
}
}

StreamingRecognizer::StreamingRecognizer(StreamingRecognizerConfig config)
    : config_(std::move(config)) {
    if (config_.threads < 1 || config_.threads > 16) {
        throw std::invalid_argument("Streaming recognition requires 1 to 16 threads");
    }
    validate_path(config_.encoder);
    validate_path(config_.decoder);
    validate_path(config_.joiner);
    validate_path(config_.tokens);

    // sherpa-onnx v1.13.8, commit 11afbd009a7f8c08f4bcf2fc1b265d0df4670fbf.
    SherpaOnnxOnlineRecognizerConfig native{};
    native.feat_config.sample_rate = sample_rate;
    native.feat_config.feature_dim = 80;
    native.model_config.transducer.encoder = config_.encoder.c_str();
    native.model_config.transducer.decoder = config_.decoder.c_str();
    native.model_config.transducer.joiner = config_.joiner.c_str();
    native.model_config.tokens = config_.tokens.c_str();
    native.model_config.num_threads = config_.threads;
    native.model_config.provider = "cpu";
    native.decoding_method = "greedy_search";
    native.enable_endpoint = 0;
    recognizer_.reset(SherpaOnnxCreateOnlineRecognizer(&native));
    if (!recognizer_) {
        throw std::runtime_error("Streaming recognizer creation failed");
    }
}

StreamingRecognizer::~StreamingRecognizer() = default;

void StreamingRecognizer::begin() {
    if (stream_) {
        throw std::logic_error("Streaming utterance is already active");
    }
    stream_.reset(SherpaOnnxCreateOnlineStream(recognizer_.get()));
    if (!stream_) {
        throw std::runtime_error("Streaming utterance creation failed");
    }
    accepted_samples_ = 0;
    last_emitted_text_.clear();
}

std::optional<std::string> StreamingRecognizer::accept(const float *samples, std::size_t count) {
    if (!stream_) {
        throw std::logic_error("Streaming accept requires an active utterance");
    }
    if (count == 0) return std::nullopt;
    if (!samples) {
        throw std::invalid_argument("Streaming samples must not be null");
    }
    if (count > max_samples - accepted_samples_) {
        throw std::length_error("Streaming utterance exceeds 15 seconds of input audio");
    }
    // Reject the whole chunk before advancing decoder state or its sample budget.
    for (std::size_t i = 0; i < count; ++i) {
        if (!std::isfinite(samples[i]) || samples[i] < -2.0f || samples[i] > 2.0f) {
            throw std::invalid_argument("Streaming samples must be finite and within [-2, 2]");
        }
    }
    try {
        SherpaOnnxOnlineStreamAcceptWaveform(stream_.get(), sample_rate, samples, static_cast<int32_t>(count));
        accepted_samples_ += count;
        drain();
        auto text = hypothesis();
        if (text.find_first_not_of(" \t\r\n\f\v") == std::string::npos || text == last_emitted_text_) {
            return std::nullopt;
        }
        last_emitted_text_ = text;
        return text;
    } catch (...) {
        // Accepted audio cannot be retried safely after an inference/result failure.
        abort();
        throw;
    }
}

std::string StreamingRecognizer::finish() {
    if (!stream_) {
        throw std::logic_error("Streaming finish requires an active utterance");
    }
    try {
        const std::array<float, lookahead_samples> padding{};
        SherpaOnnxOnlineStreamAcceptWaveform(stream_.get(), sample_rate, padding.data(),
                                           static_cast<int32_t>(padding.size()));
        SherpaOnnxOnlineStreamInputFinished(stream_.get());
        drain();
        auto text = hypothesis();
        abort();
        return text;
    } catch (...) {
        abort();
        throw;
    }
}

void StreamingRecognizer::abort() noexcept {
    stream_.reset();
    accepted_samples_ = 0;
    last_emitted_text_.clear();
}

void StreamingRecognizer::drain() {
    while (SherpaOnnxIsOnlineStreamReady(recognizer_.get(), stream_.get())) {
        SherpaOnnxDecodeOnlineStream(recognizer_.get(), stream_.get());
    }
}

std::string StreamingRecognizer::hypothesis() const {
    const auto result = std::unique_ptr<const SherpaOnnxOnlineRecognizerResult,
                                      decltype(&SherpaOnnxDestroyOnlineRecognizerResult)>(
        SherpaOnnxGetOnlineStreamResult(recognizer_.get(), stream_.get()),
        &SherpaOnnxDestroyOnlineRecognizerResult);
    if (!result || !result->text) {
        throw std::runtime_error("Streaming recognizer returned an invalid result");
    }
    // Copy owned text before destroying the snapshot, without an unbounded strlen.
    for (std::size_t size = 0; size <= max_text_bytes; ++size) {
        if (result->text[size] == '\0') return std::string(result->text, size);
    }
    throw std::length_error("Streaming hypothesis exceeds 16 KiB");
}
