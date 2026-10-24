#include "pcm_frames.h"
#include <cstdlib>
#include <iostream>
#include <limits>
#include <sstream>
#include <vector>

static void check(bool value) { if (!value) std::abort(); }
static void append(std::string &data, uint64_t value, size_t bytes) {
    for (size_t i = 0; i < bytes; ++i) data.push_back(char(value >> (i * 8)));
}
static std::string packet(uint64_t time, const std::vector<float> &values) {
    std::string data;
    append(data, time, 8);
    append(data, values.size(), 4);
    for (float value : values) {
        uint32_t bits;
        std::memcpy(&bits, &value, sizeof(bits));
        append(data, bits, 4);
    }
    return data;
}
static void rejected(std::string value) {
    std::istringstream stream(value);
    bool failed = false;
    try { read_pcm_frames(stream, [](auto, auto, auto) { return true; }); }
    catch (const std::invalid_argument &) { failed = true; }
    check(failed);
}

int main() {
    {
        std::istringstream stream(packet(1000, std::vector<float>(100, 0.25)) +
                                  packet(1006, std::vector<float>(923, 0.5)));
        std::vector<float> values;
        std::vector<uint64_t> times;
        check(read_pcm_frames(stream, [&](const float *data, size_t count, PcmPosition position) {
            values.insert(values.end(), data, data + count);
            times.push_back(position.milliseconds());
            if (count < 512) check(data[count] == 0);
            return true;
        }));
        check(values.size() == 1023 && times == std::vector<uint64_t>({1000, 1032}));
        check(values[99] == 0.25 && values[100] == 0.5 && values.back() == 0.5);
    }
    {
        std::istringstream stream(packet(0, std::vector<float>(4096, 1)));
        int calls = 0;
        check(!read_pcm_frames(stream, [&](auto, auto, auto) { ++calls; return false; }));
        check(calls == 1);
    }
    rejected("partial");
    rejected(packet(0, {}));
    rejected(packet(0, std::vector<float>(4097, 0)));
    auto truncated = packet(0, {0.5});
    truncated.pop_back();
    rejected(truncated);
    rejected(packet(0, {std::numeric_limits<float>::quiet_NaN()}));
    rejected(packet(0, {std::numeric_limits<float>::infinity()}));
    rejected(packet(0, {2.1}));
    rejected(packet(100, {0.5}) + packet(0, {0.5}));
    rejected(packet(0, {0.5}) + packet(100, {0.5}));
    rejected(packet(0, std::vector<float>(512, 0)) + packet(64, {0.5}));
    rejected(packet(100, std::vector<float>(512, 0)) + packet(100, {0.5}));
    {
        // Every packet size must preserve one sample clock, including the EOF tail.
        for (size_t packet_size : {size_t(1), size_t(100), size_t(413), size_t(512), size_t(4096)}) {
            constexpr size_t length = 5633;
            std::string data;
            for (size_t offset = 0; offset < length;) {
                const auto count = std::min(packet_size, length - offset);
                data += packet(1000 + offset / 16, std::vector<float>(count, 0.25));
                offset += count;
            }
            std::istringstream stream(data);
            size_t consumed = 0;
            check(read_pcm_frames(stream, [&](const float *samples, size_t count, PcmPosition position) {
                check(position.samples == consumed);
                check(position.milliseconds() == 1000 + consumed / 16);
                check(position.advanced(count).milliseconds() == 1000 + (consumed + count) / 16);
                check(samples[0] == 0.25 && samples[count - 1] == 0.25);
                consumed += count;
                return true;
            }));
            check(consumed == length);
        }
    }
    std::istringstream empty("");
    check(read_pcm_frames(empty, [](auto, auto, auto) { return true; }));
    std::cout << "PCM frames: little endian, timestamps, EOF tail, bounds, invalid input and cancellation PASS\n";
}
