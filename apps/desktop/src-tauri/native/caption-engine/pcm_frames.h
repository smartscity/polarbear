#pragma once

#include "pcm_position.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <istream>
#include <stdexcept>

// Preserve the original length at EOF; zero-padding is only for VAD inference.
// Capture timestamps identify packet starts, not the last packet in a VAD frame.
template <typename Consume>
bool read_pcm_frames(std::istream &input, Consume consume) {
    constexpr size_t frame_size = 512;
    constexpr size_t packet_limit = 4096;
    std::array<float, frame_size> frame{};
    size_t carried = 0;
    PcmPosition frame_start, next;
    bool first = true;
    auto little = [](const unsigned char *data, size_t count) {
        uint64_t value = 0;
        for (size_t i = 0; i < count; ++i) value |= uint64_t(data[i]) << (8 * i);
        return value;
    };
    for (;;) {
        std::array<unsigned char, 12> header{};
        input.read(reinterpret_cast<char *>(header.data()), header.size());
        if (input.gcount() == 0 && input.eof()) break;
        if (size_t(input.gcount()) != header.size()) throw std::invalid_argument("Truncated PCM header");
        const uint64_t timestamp = little(header.data(), 8), count = little(header.data() + 8, 4);
        if (count == 0 || count > packet_limit || timestamp > UINT64_MAX / 1000 - 1000)
            throw std::invalid_argument("Invalid PCM packet");
        if (first) next.origin_ms = timestamp;
        const auto expected = next.milliseconds();
        // Quantization tolerance is relative to the epoch, never accumulated per packet.
        if ((timestamp > expected && timestamp - expected > 1) ||
            (expected > timestamp && expected - timestamp > 1))
            throw std::invalid_argument("Discontinuous PCM timestamp");
        first = false;
        std::array<unsigned char, packet_limit * sizeof(float)> bytes{};
        input.read(reinterpret_cast<char *>(bytes.data()), count * sizeof(float));
        if (size_t(input.gcount()) != count * sizeof(float))
            throw std::invalid_argument("Truncated PCM samples");
        for (size_t i = 0; i < count; ++i) {
            const uint32_t bits = static_cast<uint32_t>(little(bytes.data() + i * sizeof(float), sizeof(float)));
            float value;
            std::memcpy(&value, &bits, sizeof(value));
            if (!std::isfinite(value) || std::abs(value) > 2)
                throw std::invalid_argument("Invalid PCM sample");
            if (carried == 0) frame_start = next;
            frame[carried++] = value;
            next = next.advanced(1);
            if (carried == frame_size) {
                if (!consume(frame.data(), carried, frame_start)) return false;
                carried = 0;
            }
        }
    }
    if (carried) {
        std::fill(frame.begin() + carried, frame.end(), 0.0f);
        if (!consume(frame.data(), carried, frame_start)) return false;
    }
    return true;
}
