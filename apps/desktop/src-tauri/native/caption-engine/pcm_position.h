#pragma once

#include <cstddef>
#include <cstdint>
#include <stdexcept>

// A single epoch anchor and integer sample offset survive transport/VAD splitting.
struct PcmPosition {
    uint64_t origin_ms = 0;
    uint64_t samples = 0;

    uint64_t milliseconds() const {
        const auto delta = samples / 16; // 16 kHz PCM.
        if (delta > UINT64_MAX - origin_ms) throw std::invalid_argument("PCM clock overflow");
        return origin_ms + delta;
    }

    PcmPosition advanced(size_t count) const {
        if (count > UINT64_MAX - samples) throw std::invalid_argument("PCM sample overflow");
        return {origin_ms, samples + count};
    }

    PcmPosition preceding(size_t count) const {
        if (count > samples) throw std::invalid_argument("PCM preroll before epoch");
        return {origin_ms, samples - count};
    }
};
