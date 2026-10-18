#pragma once

#include <atomic>
#include <condition_variable>
#include <chrono>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <vector>

struct RecognitionJob {
    std::vector<float> samples;
    uint64_t sequence, start_ms, end_ms;
    bool final;
    std::chrono::steady_clock::time_point queued_at = std::chrono::steady_clock::now();
};

// One consumer owns the model. Provisional work is expendable, finalized audio is not.
class RecognitionQueue {
public:
    explicit RecognitionQueue(size_t sample_budget) : budget_(sample_budget) {}

    bool offer_partial(const std::vector<float> &samples, uint64_t sequence,
                       uint64_t start_ms, uint64_t end_ms) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_ || busy_ || partial_ || !finals_.empty() || samples.size() > budget_) return false;
        partial_ = RecognitionJob{samples, sequence, start_ms, end_ms, false};
        ready_.notify_one();
        return true;
    }

    bool submit_final(RecognitionJob job) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_ || !job.final || job.samples.empty() || job.samples.size() > budget_ - queued_samples_) return false;
        partial_.reset();
        // Do not throw away the first in-flight preview of this utterance on a
        // silence boundary. Later previews are expendable once text is visible.
        cancel_partial_.store(!active_ || active_->final ||
                              active_->sequence != job.sequence || visible_sequence_ == job.sequence);
        queued_samples_ += job.samples.size();
        finals_.push_back(std::move(job));
        ready_.notify_one();
        return true;
    }

    std::optional<RecognitionJob> take() {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [&] { return closed_ || partial_ || !finals_.empty(); });
        if (finals_.empty() && !partial_) return std::nullopt;
        RecognitionJob job;
        if (!finals_.empty()) {
            job = std::move(finals_.front());
            finals_.pop_front();
            queued_samples_ -= job.samples.size();
        } else {
            job = std::move(*partial_);
            partial_.reset();
        }
        busy_ = true;
        active_ = ActiveJob{job.sequence, job.final};
        cancel_partial_.store(false);
        return job;
    }

    void complete(bool text_emitted = false) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (text_emitted && active_) visible_sequence_ = active_->sequence;
        else if (active_ && !active_->final && !cancelled(false)) empty_preview_ = active_->sequence;
        active_.reset();
        busy_ = false;
    }

    bool consume_empty_preview(uint64_t sequence) {
        std::lock_guard<std::mutex> lock(mutex_);
        const bool retry = empty_preview_ && *empty_preview_ == sequence && visible_sequence_ != sequence;
        empty_preview_.reset();
        return retry;
    }

    bool cancelled(bool final) const {
        return aborted_.load() || (!final && cancel_partial_.load());
    }

    void close() {
        std::lock_guard<std::mutex> lock(mutex_);
        closed_ = true;
        partial_.reset();
        cancel_partial_.store(true);
        ready_.notify_one();
    }

    void abort() {
        std::lock_guard<std::mutex> lock(mutex_);
        closed_ = true;
        aborted_.store(true);
        partial_.reset();
        finals_.clear();
        queued_samples_ = 0;
        ready_.notify_one();
    }

private:
    struct ActiveJob { uint64_t sequence; bool final; };
    const size_t budget_;
    std::mutex mutex_;
    std::condition_variable ready_;
    std::deque<RecognitionJob> finals_;
    std::optional<RecognitionJob> partial_;
    std::optional<ActiveJob> active_;
    std::optional<uint64_t> empty_preview_;
    uint64_t visible_sequence_ = 0;
    size_t queued_samples_ = 0;
    bool busy_ = false, closed_ = false;
    std::atomic<bool> cancel_partial_{false}, aborted_{false};
};
