#include "streaming_input.h"
#include "pcm_frames.h"
#include <cstdlib>
#include <future>
#include <iostream>
#include <map>
#include <sstream>

static void check(bool value) { if (!value) std::abort(); }

int main() {
    {
        StreamingInputQueue queue(4, 3);
        check(queue.submit({{1, 2}, 1, 0, 2, false}));
        check(queue.submit({{3, 4}, 1, 0, 4, false}));
        check(!queue.submit({{5}, 1, 0, 5, false}));
        check(queue.submit({{}, 1, 0, 4, true}));
        check(!queue.submit({{}, 2, 4, 4, true}));
        queue.close();
        check(queue.take()->samples == std::vector<float>({1, 2}));
        check(queue.take()->samples == std::vector<float>({3, 4}));
        check(queue.take()->final);
        check(!queue.take());
        check(!queue.submit({{1}, 2, 4, 5, false}));
    }
    {
        StreamingInputQueue queue(4);
        auto waiting = std::async(std::launch::async, [&] { return queue.take(); });
        check(queue.submit({{1}, 1, 0, 1, false}));
        check(waiting.get()->samples == std::vector<float>({1}));
        check(queue.submit({{2}, 1, 0, 2, false}));
        queue.abort();
        check(!queue.take());
    }
    {
        StreamingInputQueue queue(4);
        auto waiting = std::async(std::launch::async, [&] { return queue.take(); });
        queue.close();
        check(!waiting.get());
    }
    {
        std::vector<RecognitionJob> jobs;
        StreamingSegmenter segmenter([&](auto job) { jobs.push_back(std::move(job)); return true; });
        std::vector<float> expected;
        // Cross the fifteen-second boundary and retain a non-frame-aligned tail.
        size_t total = StreamingSegmenter::max_samples + 9001;
        for (size_t offset = 0; offset < total;) {
            const auto count = std::min(size_t(512), total - offset);
            std::vector<float> input(count);
            for (size_t i = 0; i < count; ++i) input[i] = float(offset + i);
            expected.insert(expected.end(), input.begin(), input.end());
            check(segmenter.accept(input.data(), count, {0, offset}, true));
            offset += count;
        }
        check(segmenter.finish());
        check(segmenter.finish());
        std::vector<float> actual;
        std::map<uint64_t, size_t> counts;
        uint64_t finished = 0;
        for (const auto &job : jobs) {
            check(job.sequence == finished + 1);
            check(job.end_ms >= job.start_ms);
            actual.insert(actual.end(), job.samples.begin(), job.samples.end());
            counts[job.sequence] += job.samples.size();
            if (job.final) ++finished;
        }
        check(actual == expected);
        check(finished == 2);
        check(counts[1] == StreamingSegmenter::max_samples);
        check(counts[2] == 9001);
    }
    {
        std::vector<RecognitionJob> jobs;
        StreamingSegmenter segmenter([&](auto job) { jobs.push_back(std::move(job)); return true; });
        std::vector<float> silence(512, 0), speech(512, 1);
        uint64_t time = 0;
        for (int i = 0; i < 20; ++i, time += 32)
            check(segmenter.accept(silence.data(), 512, {0, time * 16}, false));
        for (int i = 0; i < 10; ++i, time += 32)
            check(segmenter.accept(speech.data(), 512, {0, time * 16}, true));
        for (int i = 0; i < 19; ++i, time += 32)
            check(segmenter.accept(silence.data(), 512, {0, time * 16}, false));
        check(segmenter.finish());
        check(jobs.front().start_ms == 440);
        check(jobs.back().final);
        size_t zeros = 0, ones = 0, finals = 0;
        for (auto &job : jobs) {
            for (auto value : job.samples) value == 0 ? ++zeros : ++ones;
            finals += job.final;
        }
        check(zeros == 3200 + 19 * 512);
        check(ones == 10 * 512);
        check(finals == 1);
    }
    {
        size_t calls = 0;
        StreamingSegmenter segmenter([&](auto) { ++calls; return false; });
        std::vector<float> speech(512, 1);
        for (size_t i = 0; i < 10; ++i) check(segmenter.accept(speech.data(), 512, {0, i * 512}, true));
        check(!segmenter.accept(speech.data(), 512, {0, 5120}, true));
        check(!segmenter.finish());
        check(!segmenter.accept(speech.data(), 512, {0, 5632}, true));
        check(calls == 1);
    }
    {
        size_t calls = 0;
        StreamingSegmenter segmenter([&](auto) { ++calls; return true; });
        std::vector<float> speech(511, 1);
        check(segmenter.accept(speech.data(), speech.size(), {}, true));
        check(segmenter.finish());
        check(calls == 0);
    }
    {
        // Regression: rounding packet starts used to produce ends 352, 351, 351.
        std::string wire;
        size_t total = 0;
        auto append = [&](uint64_t value, size_t bytes) {
            for (size_t i = 0; i < bytes; ++i) wire.push_back(char(value >> (8 * i)));
        };
        for (size_t count : {512, 512, 512, 512, 512, 512, 512, 512, 512, 512, 100, 413}) {
            append(total / 16, 8);
            append(count, 4);
            for (size_t i = 0; i < count; ++i) append(0x3f000000, 4);
            total += count;
        }
        std::vector<RecognitionJob> jobs;
        StreamingSegmenter segmenter([&](auto job) { jobs.push_back(std::move(job)); return true; });
        std::istringstream input(wire);
        check(read_pcm_frames(input, [&](auto data, auto count, auto position) {
            return segmenter.accept(data, count, position, true);
        }));
        check(segmenter.finish());
        uint64_t previous = 0;
        size_t processed = 0;
        for (const auto &job : jobs) {
            check(job.end_ms >= previous);
            processed += job.samples.size();
            check(job.end_ms == processed / 16);
            previous = job.end_ms;
        }
        check(processed == 5633 && jobs.back().final);
    }
    std::cout << "Streaming input: exact-once deltas, bounds, drain, abort, VAD boundaries and tails PASS\n";
}
