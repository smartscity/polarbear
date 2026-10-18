// Evaluation-only whole-utterance adapter: no VAD, partial retries, or product changes.
#include "whisper.h"
#include "json.hpp"
#include <chrono>
#include <charconv>
#include <cstdint>
#include <ctime>
#include <iostream>
#include <memory>
#include <string_view>
#include <vector>

using Clock = std::chrono::steady_clock;
using json = nlohmann::ordered_json;

static double elapsed(Clock::time_point start) {
    return std::chrono::duration<double>(Clock::now() - start).count();
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    const std::string_view argument(argv[2]);
    int threads = 0;
    const auto parsed = std::from_chars(argument.data(), argument.data() + argument.size(), threads);
    if (parsed.ec != std::errc{} || parsed.ptr != argument.data() + argument.size() || threads < 1 || threads > 16) return 2;
    whisper_log_set([](enum ggml_log_level, const char *, void *) {}, nullptr);
    auto config = whisper_context_default_params();
    config.use_gpu = false;
    const auto start = Clock::now();
    auto context = std::unique_ptr<whisper_context, decltype(&whisper_free)>(
        whisper_init_from_file_with_params(argv[1], config), whisper_free);
    if (!context) return 3;
    std::cout << json({{"loadSeconds", elapsed(start)}, {"threads", threads}}).dump() << std::endl;
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = threads;
    params.language = "en";
    params.translate = false;
    params.no_context = true;
    params.print_realtime = params.print_progress = params.print_timestamps = params.print_special = false;
    params.temperature_inc = 0;
    params.suppress_nst = true;
    unsigned char header[4];
    while (std::cin.read(reinterpret_cast<char *>(header), 4)) {
        const uint32_t count = uint32_t(header[0]) | (uint32_t(header[1]) << 8)
            | (uint32_t(header[2]) << 16) | (uint32_t(header[3]) << 24);
        if (!count || count > 16000 * 60) return 4;
        std::vector<float> samples(count);
        if (!std::cin.read(reinterpret_cast<char *>(samples.data()), count * sizeof(float))) return 4;
        whisper_reset_timings(context.get());
        const auto cpu_began = std::clock();
        const auto began = Clock::now();
        if (whisper_full(context.get(), params, samples.data(), count) != 0) return 5;
        const double wall_seconds = elapsed(began);
        const double cpu_seconds = static_cast<double>(std::clock() - cpu_began) / CLOCKS_PER_SEC;
        auto timings = std::unique_ptr<whisper_timings>(whisper_get_timings(context.get()));
        if (!timings) return 6;
        std::string text;
        for (int i = 0; i < whisper_full_n_segments(context.get()); ++i) {
            if (whisper_full_get_segment_no_speech_prob(context.get(), i) < 0.6f)
                text += whisper_full_get_segment_text(context.get(), i);
        }
        // Upstream reports per-operation means, not additive phase totals.
        std::cout << json({{"text", text}, {"decodeSeconds", wall_seconds},
            {"processCpuSeconds", cpu_seconds}, {"encodeMeanMs", timings->encode_ms},
            {"decodeMeanMs", timings->decode_ms}, {"promptMeanMs", timings->prompt_ms},
            {"batchDecodeMeanMs", timings->batchd_ms}, {"sampleMeanMs", timings->sample_ms}}).dump() << std::endl;
    }
    return std::cin.eof() && std::cin.gcount() == 0 ? 0 : 4;
}
