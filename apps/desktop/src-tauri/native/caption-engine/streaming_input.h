#pragma once

#include "recognition_queue.h"
#include <algorithm>
#include <functional>
#include <stdexcept>

// Incremental PCM is never replaceable. A single consumer owns inference state.
class StreamingInputQueue {
public:
    explicit StreamingInputQueue(size_t sample_budget, size_t job_budget = 1024)
        : sample_budget_(sample_budget), job_budget_(job_budget) {}

    bool submit(RecognitionJob job) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_ || (job.samples.empty() && !job.final) ||
            jobs_.size() >= job_budget_ || job.samples.size() > sample_budget_ - queued_samples_) return false;
        queued_samples_ += job.samples.size();
        jobs_.push_back(std::move(job));
        ready_.notify_one();
        return true;
    }

    std::optional<RecognitionJob> take() {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [&] { return closed_ || !jobs_.empty(); });
        if (jobs_.empty()) return std::nullopt;
        auto job = std::move(jobs_.front());
        jobs_.pop_front();
        queued_samples_ -= job.samples.size();
        return job;
    }

    void close() {
        std::lock_guard<std::mutex> lock(mutex_);
        closed_ = true;
        ready_.notify_one();
    }

    void abort() {
        std::lock_guard<std::mutex> lock(mutex_);
        closed_ = true;
        jobs_.clear();
        queued_samples_ = 0;
        ready_.notify_one();
    }

private:
    const size_t sample_budget_, job_budget_;
    std::mutex mutex_;
    std::condition_variable ready_;
    std::deque<RecognitionJob> jobs_;
    size_t queued_samples_ = 0;
    bool closed_ = false;
};

// VAD owns boundaries; this object owns sample accounting, not model state.
// Audio before the minimum duration is buffered, then delivered exactly once.
class StreamingSegmenter {
public:
    static constexpr size_t sample_rate = 16000;
    static constexpr size_t max_samples = sample_rate * 15;
    static constexpr size_t min_samples = sample_rate / 3;
    static constexpr size_t preroll_samples = sample_rate / 5;
    static constexpr size_t silence_samples = sample_rate * 3 / 5;
    using Submit = std::function<bool(RecognitionJob)>;

    explicit StreamingSegmenter(Submit submit) : submit_(std::move(submit)) {}

    bool accept(const float *samples, size_t count, uint64_t timestamp_ms, bool talking) {
        if (failed_) return false;
        if (count == 0 || count > 512 || !samples) throw std::invalid_argument("Invalid VAD frame");
        size_t offset = 0;
        while (offset < count) {
            if (!active_ && !talking) {
                preroll_.insert(preroll_.end(), samples + offset, samples + count);
                if (preroll_.size() > preroll_samples)
                    preroll_.erase(preroll_.begin(), preroll_.end() - preroll_samples);
                return true;
            }
            if (!active_) {
                active_ = true;
                pending_ = std::move(preroll_);
                preroll_.clear();
                accepted_ = pending_.size();
                const auto time = timestamp_ms + offset * 1000 / sample_rate;
                const auto preroll_ms = accepted_ * 1000 / sample_rate;
                start_ = time > preroll_ms ? time - preroll_ms : 0;
            }
            const size_t length = std::min(count - offset, max_samples - accepted_);
            pending_.insert(pending_.end(), samples + offset, samples + offset + length);
            offset += length;
            accepted_ += length;
            quiet_ = talking ? 0 : quiet_ + length;
            end_ = timestamp_ms + offset * 1000 / sample_rate;
            if (accepted_ >= min_samples && !flush(false)) return false;
            if (accepted_ == max_samples || quiet_ >= silence_samples) {
                if (!finish()) return false;
            }
        }
        return true;
    }

    bool finish() {
        if (failed_) return false;
        if (!active_) return true;
        if (accepted_ >= min_samples && !flush(true)) return false;
        if (accepted_ >= min_samples) ++sequence_;
        active_ = false;
        accepted_ = quiet_ = 0;
        pending_.clear();
        preroll_.clear();
        return true;
    }

private:
    bool flush(bool final) {
        RecognitionJob job{std::move(pending_), sequence_, start_, end_, final};
        pending_.clear();
        if (!submit_(std::move(job))) {
            failed_ = true;
            return false;
        }
        return true;
    }

    Submit submit_;
    std::vector<float> preroll_, pending_;
    size_t accepted_ = 0, quiet_ = 0;
    uint64_t sequence_ = 1, start_ = 0, end_ = 0;
    bool active_ = false, failed_ = false;
};
