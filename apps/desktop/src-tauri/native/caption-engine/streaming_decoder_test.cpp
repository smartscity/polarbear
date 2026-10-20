#include "streaming_decoder.h"
#include "streaming_input.h"
#include <cstdlib>
#include <iostream>

static void check(bool value) { if (!value) std::abort(); }

struct Recognizer {
    bool active = false, throws = false;
    size_t samples = 0, finishes = 0;
    std::string partial = "provisional", final = "confirmed";
    void begin() { check(!active); active = true; }
    std::optional<std::string> accept(const float *, size_t count) {
        check(active);
        if (throws) throw std::runtime_error("Injected inference failure");
        samples += count;
        return partial;
    }
    std::string finish() { check(active); ++finishes; active = false; return final; }
    void abort() { active = false; }
};

int main() {
    Recognizer model;
    std::vector<std::pair<bool, std::string>> output;
    StreamingDecoder decoder(model, [&](auto, auto start, auto end, bool final, const auto &text) {
        check(end >= start);
        output.emplace_back(final, text);
    });
    decoder.consume({{0.1f}, 1, 0, 32, false});
    model.final = "";
    decoder.consume({{}, 1, 0, 32, true});
    check(output.size() == 2 && !output.back().first && output.back().second.empty());
    check(model.finishes == 1 && !model.active);
    bool rejected = false;
    try { decoder.consume({{}, 1, 0, 32, true}); } catch (const std::logic_error &) { rejected = true; }
    check(rejected);
    model.final = "confirmed";
    // Capacity rejection seals admission, but completed accepted work still drains.
    StreamingInputQueue queue(2, 8);
    check(queue.submit({{0.2f}, 2, 32, 64, false}));
    check(queue.submit({{}, 2, 32, 64, true}));
    check(queue.submit({{0.3f}, 3, 64, 96, false}));
    check(!queue.submit({{0.4f}, 3, 64, 128, false}));
    queue.close();
    while (auto job = queue.take()) decoder.consume(*job);
    decoder.close();
    check(model.finishes == 2 && model.samples == 3 && !model.active);
    size_t finals = 0;
    for (const auto &item : output) {
        if (item.first) { ++finals; check(item.second == "confirmed"); }
    }
    check(finals == 1 && !output.back().first && output.back().second.empty());
    // Empty finals without a visible hypothesis never create a durable blank row.
    Recognizer silent;
    silent.partial = silent.final = "";
    size_t events = 0;
    StreamingDecoder empty(silent, [&](auto, auto, auto, auto, auto) { ++events; });
    empty.consume({{0}, 1, 0, 1, true});
    empty.close();
    check(events == 0);
    // A decoder error is an abort, not an opportunity to retry consumed audio.
    Recognizer broken;
    StreamingDecoder failing(broken, [&](auto, auto, auto, auto, auto) {});
    broken.throws = true;
    rejected = false;
    try { failing.consume({{0}, 1, 0, 1, false}); } catch (const std::runtime_error &) { rejected = true; }
    failing.close();
    check(rejected && !broken.active && broken.finishes == 0);
    std::cout << "Streaming decoder: ordered finals, overload drain, uncertain-tail clear and failure cleanup PASS\n";
}
