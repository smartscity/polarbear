#include "streaming_input.h"
#include <cstdlib>
#include <future>
#include <iostream>
#include <map>

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
            check(segmenter.accept(input.data(), count, offset * 1000 / 16000, true));
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
            check(segmenter.accept(silence.data(), 512, time, false));
        for (int i = 0; i < 10; ++i, time += 32)
            check(segmenter.accept(speech.data(), 512, time, true));
        for (int i = 0; i < 19; ++i, time += 32)
            check(segmenter.accept(silence.data(), 512, time, false));
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
        for (size_t i = 0; i < 10; ++i) check(segmenter.accept(speech.data(), 512, i * 32, true));
        check(!segmenter.accept(speech.data(), 512, 320, true));
        check(!segmenter.finish());
        check(!segmenter.accept(speech.data(), 512, 352, true));
        check(calls == 1);
    }
    {
        size_t calls = 0;
        StreamingSegmenter segmenter([&](auto) { ++calls; return true; });
        std::vector<float> speech(511, 1);
        check(segmenter.accept(speech.data(), speech.size(), 0, true));
        check(segmenter.finish());
        check(calls == 0);
    }
    std::cout << "Streaming input: exact-once deltas, bounds, drain, abort, VAD boundaries and tails PASS\n";
}
