#include "whisper.h"
#include <cstdio>
#include <memory>
#include <vector>

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    whisper_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
    auto config = whisper_context_default_params();
    config.use_gpu = false;
    auto context = std::unique_ptr<whisper_context, decltype(&whisper_free)>(
        whisper_init_from_file_with_params(argv[1], config), whisper_free);
    if (!context) return 3;
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = 2;
    params.language = "en";
    params.no_context = true;
    params.temperature_inc = 0;
    params.print_realtime = params.print_progress = params.print_timestamps = params.print_special = false;
    int callbacks = 0;
    params.abort_callback = [](void *data) { ++*static_cast<int *>(data); return true; };
    params.abort_callback_user_data = &callbacks;
    std::vector<float> audio(16000 * 2, 0.0f);
    const int cancelled = whisper_full(context.get(), params, audio.data(), audio.size());
    auto timings = std::unique_ptr<whisper_timings>(whisper_get_timings(context.get()));
    // This is a structural assertion, independent of runner wall-clock speed.
    if (cancelled == 0 || callbacks == 0 || !timings || timings->encode_ms != 0) {
        std::fprintf(stderr, "Cancellation completed the encoder instead of interrupting its graph\n");
        return 4;
    }
    params.abort_callback = nullptr;
    params.abort_callback_user_data = nullptr;
    if (whisper_full(context.get(), params, audio.data(), audio.size()) != 0) return 5;
    return 0;
}
