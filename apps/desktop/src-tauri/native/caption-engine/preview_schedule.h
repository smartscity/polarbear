#pragma once
#include <algorithm>
#include <cstddef>

// Sample-clock scheduling is independent of inference speed and wall-clock jitter.
class PreviewSchedule {
public:
    explicit PreviewSchedule(size_t sample_rate) : rate_(sample_rate), next_(sample_rate) {}
    bool due(size_t samples, size_t quiet_samples = 0) const {
        // A pending silence boundary will submit the complete utterance. Starting
        // a preview here repeats the encoder and delays that authoritative job.
        return quiet_samples == 0 && samples >= next_;
    }
    void attempted(size_t samples, bool accepted) {
        next_ = samples + (accepted ? rate_ * 2 : rate_ / 8);
    }
    void reset() { next_ = rate_; }
    // Completion feedback means inference is idle; only rejected admission backs off.
    void retry_empty(size_t samples) { next_ = std::min(next_, samples); }
private:
    const size_t rate_;
    size_t next_;
};
