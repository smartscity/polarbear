#include "streaming_recognizer.h"
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

// The C API double exercises ownership and invalid states, not ASR accuracy.
struct SherpaOnnxOnlineRecognizer {};
struct SherpaOnnxOnlineStream {};
static SherpaOnnxOnlineRecognizer model;
static SherpaOnnxOnlineStream stream;
static bool model_live = false, stream_live = false, create_fails = false, result_fails = false;
static int ready = 0, finishes = 0, snapshots = 0;
static size_t sample_count = 0;
static std::string text;
static void check(bool value) { if (!value) std::abort(); }

extern "C" {
const SherpaOnnxOnlineRecognizer *SherpaOnnxCreateOnlineRecognizer(const SherpaOnnxOnlineRecognizerConfig *config) {
    check(config->feat_config.sample_rate == 16000);
    check(config->feat_config.feature_dim == 80);
    check(std::strcmp(config->model_config.provider, "cpu") == 0);
    check(std::strcmp(config->decoding_method, "greedy_search") == 0);
    check(config->enable_endpoint == 0);
    check(!model_live);
    if (create_fails) return nullptr;
    model_live = true;
    return &model;
}
void SherpaOnnxDestroyOnlineRecognizer(const SherpaOnnxOnlineRecognizer *value) {
    check(value == &model && model_live && !stream_live);
    model_live = false;
}
const SherpaOnnxOnlineStream *SherpaOnnxCreateOnlineStream(const SherpaOnnxOnlineRecognizer *value) {
    check(value == &model && model_live && !stream_live);
    stream_live = true;
    sample_count = 0;
    text.clear();
    return &stream;
}
void SherpaOnnxDestroyOnlineStream(const SherpaOnnxOnlineStream *value) {
    check(value == &stream && model_live && stream_live && snapshots == 0);
    stream_live = false;
}
void SherpaOnnxOnlineStreamAcceptWaveform(const SherpaOnnxOnlineStream *value, int32_t rate, const float *, int32_t count) {
    check(value == &stream && stream_live && rate == 16000 && count > 0);
    sample_count += count;
    ready += 2;
}
int32_t SherpaOnnxIsOnlineStreamReady(const SherpaOnnxOnlineRecognizer *, const SherpaOnnxOnlineStream *) {
    return ready > 0;
}
void SherpaOnnxDecodeOnlineStream(const SherpaOnnxOnlineRecognizer *, const SherpaOnnxOnlineStream *) {
    check(ready > 0);
    --ready;
}
const SherpaOnnxOnlineRecognizerResult *SherpaOnnxGetOnlineStreamResult(
    const SherpaOnnxOnlineRecognizer *, const SherpaOnnxOnlineStream *) {
    check(stream_live && ready == 0);
    if (result_fails) return nullptr;
    auto *result = new SherpaOnnxOnlineRecognizerResult{};
    result->text = ::strdup(text.c_str());
    ++snapshots;
    return result;
}
void SherpaOnnxDestroyOnlineRecognizerResult(const SherpaOnnxOnlineRecognizerResult *result) {
    --snapshots;
    std::free(const_cast<char *>(result->text));
    delete result;
}
void SherpaOnnxOnlineStreamInputFinished(const SherpaOnnxOnlineStream *) {
    ++finishes;
    check(stream_live);
}
}

template <typename Exception, typename Action> static void rejects(Action action) {
    bool rejected = false;
    try { action(); } catch (const Exception &) { rejected = true; }
    check(rejected);
}

int main() {
    const StreamingRecognizerConfig config{"encoder", "decoder", "joiner", "tokens", 3};
    {
        auto invalid = config;
        invalid.threads = 0;
        rejects<std::invalid_argument>([&] { StreamingRecognizer recognizer(invalid); });
        invalid.threads = 17;
        rejects<std::invalid_argument>([&] { StreamingRecognizer recognizer(invalid); });
        invalid = config;
        invalid.encoder = "";
        rejects<std::invalid_argument>([&] { StreamingRecognizer recognizer(invalid); });
        invalid.encoder = std::string("file\0name", 9);
        rejects<std::invalid_argument>([&] { StreamingRecognizer recognizer(invalid); });
        create_fails = true;
        rejects<std::runtime_error>([&] { StreamingRecognizer recognizer(config); });
        create_fails = false;
    }
    {
        StreamingRecognizer recognizer(config);
        const std::vector<float> audio(512, 0.5f);
        rejects<std::logic_error>([&] { recognizer.accept(audio.data(), audio.size()); });
        rejects<std::logic_error>([&] { recognizer.finish(); });
        recognizer.begin();
        rejects<std::logic_error>([&] { recognizer.begin(); });
        check(!recognizer.accept(nullptr, 0));
        rejects<std::invalid_argument>([&] { recognizer.accept(nullptr, 1); });
        for (float invalid : {std::numeric_limits<float>::quiet_NaN(),
                              std::numeric_limits<float>::infinity(), -2.1f, 2.1f}) {
            rejects<std::invalid_argument>([&] { recognizer.accept(&invalid, 1); });
        }
        check(sample_count == 0);
        check(!recognizer.accept(audio.data(), audio.size()));
        text = "meeting";
        check(recognizer.accept(audio.data(), audio.size()) == "meeting");
        check(!recognizer.accept(audio.data(), audio.size()));
        text = "meeting agenda";
        check(recognizer.accept(audio.data(), audio.size()) == "meeting agenda");
        check(recognizer.finish() == "meeting agenda");
        check(sample_count == audio.size() * 4 + 10560 && finishes == 1 && snapshots == 0);
        check(!stream_live);
        recognizer.begin();
        check(!recognizer.accept(audio.data(), audio.size()));
        recognizer.abort();
        recognizer.abort();
        check(!stream_live);
        recognizer.begin();
        result_fails = true;
        rejects<std::runtime_error>([&] { recognizer.accept(audio.data(), audio.size()); });
        check(!stream_live);
        result_fails = false;
        recognizer.begin();
        text.assign(16385, 'a');
        rejects<std::length_error>([&] { recognizer.finish(); });
        check(!stream_live && snapshots == 0);
        recognizer.begin();
        const std::vector<float> maximum(240000, 0.1f);
        recognizer.accept(maximum.data(), maximum.size());
        rejects<std::length_error>([&] { recognizer.accept(audio.data(), 1); });
        check(sample_count == maximum.size());
        // Destructor must release an active stream before the recognizer.
    }
    check(!stream_live && !model_live && snapshots == 0);
    std::cout << "Streaming adapter: lifecycle, owned hypotheses, limits, lookahead and failure cleanup PASS\n";
}
