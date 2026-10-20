#pragma once

#include <sherpa-onnx/c-api/c-api.h>

#include <cstddef>
#include <memory>
#include <optional>
#include <string>

struct StreamingRecognizerConfig {
    std::string encoder;
    std::string decoder;
    std::string joiner;
    std::string tokens;
    int threads = 1;
};

// Single-owner adapter: callers serialize all operations, including abort().
// Capture timestamps, VAD boundaries and event delivery remain with the caller.
class StreamingRecognizer {
public:
    explicit StreamingRecognizer(StreamingRecognizerConfig config);
    ~StreamingRecognizer();

    StreamingRecognizer(const StreamingRecognizer &) = delete;
    StreamingRecognizer &operator=(const StreamingRecognizer &) = delete;
    StreamingRecognizer(StreamingRecognizer &&) = delete;
    StreamingRecognizer &operator=(StreamingRecognizer &&) = delete;

    void begin();
    // Empty chunks are no-ops. Only changed, nonblank full hypotheses are returned.
    std::optional<std::string> accept(const float *samples, std::size_t count);
    // The 660 ms lookahead padding is internal, not caller audio or timestamp time.
    // Finishing releases the stream on both success and failure.
    std::string finish();
    // Idempotent stream release, not concurrent cancellation of an active decode.
    void abort() noexcept;

private:
    void drain();
    std::string hypothesis() const;

    const StreamingRecognizerConfig config_;
    using RecognizerHandle = std::unique_ptr<const SherpaOnnxOnlineRecognizer,
                                            decltype(&SherpaOnnxDestroyOnlineRecognizer)>;
    using StreamHandle = std::unique_ptr<const SherpaOnnxOnlineStream,
                                        decltype(&SherpaOnnxDestroyOnlineStream)>;
    // Reverse member destruction releases the stream before its model owner.
    RecognizerHandle recognizer_{nullptr, &SherpaOnnxDestroyOnlineRecognizer};
    StreamHandle stream_{nullptr, &SherpaOnnxDestroyOnlineStream};
    std::size_t accepted_samples_ = 0;
    std::string last_emitted_text_;
};
