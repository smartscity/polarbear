#pragma once
#include <cstddef>

// Sample-clock scheduling is independent of inference speed and wall-clock jitter.
class PreviewSchedule {
public:
    explicit PreviewSchedule(size_t sample_rate) : rate_(sample_rate), next_(sample_rate * 3 / 2) {}
    bool due(size_t samples) const { return samples >= next_; }
    void attempted(size_t samples, bool accepted) {
        next_ = samples + (accepted ? rate_ * 2 : rate_ / 8);
    }
    void reset() { next_ = rate_ * 3 / 2; }
private:
    const size_t rate_;
    size_t next_;
};
