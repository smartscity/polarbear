#pragma once

#include <algorithm>
#include <charconv>
#include <optional>
#include <string_view>

struct InferenceConfig {
    int threads;
    bool diagnostics = false;
};

// Leave scheduling capacity for capture/VAD and the GUI on small CPU allocations.
inline int inference_threads(unsigned available) {
    return static_cast<int>(std::min(4u, available > 1 ? available - 1 : 1u));
}

inline std::optional<InferenceConfig> inference_config(int argc, char **argv, unsigned available,
                                                       int options_start = 3) {
    if (options_start < 3 || argc < options_start) return std::nullopt;
    InferenceConfig config{inference_threads(available)};
    bool threads_seen = false;
    for (int i = options_start; i < argc; ++i) {
        const std::string_view argument(argv[i]);
        if (argument == "--diagnostics" && !config.diagnostics) {
            config.diagnostics = true;
        } else if (argument.substr(0, 10) == "--threads=" && !threads_seen) {
            const auto value = argument.substr(10);
            int threads = 0;
            const auto parsed = std::from_chars(value.data(), value.data() + value.size(), threads);
            if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size() || threads < 1 || threads > 16) return std::nullopt;
            config.threads = threads;
            threads_seen = true;
        } else {
            return std::nullopt;
        }
    }
    return config;
}
