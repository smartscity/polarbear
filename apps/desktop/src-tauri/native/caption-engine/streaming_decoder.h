#pragma once

#include "recognition_queue.h"
#include <functional>
#include <stdexcept>
#include <string>

// One decoder thread owns stream lifetime and publishes only ordered results.
// The recognizer template permits deterministic lifecycle tests without model inference.
template <typename Recognizer>
class StreamingDecoder {
public:
    using Publish = std::function<void(uint64_t, uint64_t, uint64_t, bool, const std::string &)>;

    StreamingDecoder(Recognizer &recognizer, Publish publish)
        : recognizer_(recognizer), publish_(std::move(publish)) {}

    void consume(const RecognitionJob &job) {
        if (sequence_ == 0) {
            if (job.sequence <= closed_sequence_) throw std::logic_error("Replayed streaming sequence");
            recognizer_.begin();
            sequence_ = job.sequence;
            start_ = job.start_ms;
            end_ = start_;
        }
        if (job.sequence != sequence_ || job.start_ms != start_ || job.end_ms < end_)
            throw std::logic_error("Out-of-order streaming audio");
        end_ = job.end_ms;
        auto text = recognizer_.accept(job.samples.data(), job.samples.size());
        if (job.final) text = recognizer_.finish();
        if (text && text->find_first_not_of(" \t\r\n\f\v") != std::string::npos) {
            publish_(sequence_, start_, end_, job.final, *text);
            visible_ = !job.final;
        } else if (job.final) {
            clear_partial();
        }
        if (job.final) {
            closed_sequence_ = sequence_;
            sequence_ = 0;
        }
    }

    // A closed queue can end with an unfinished sequence after admission failure.
    // Never promote that uncertain tail into a successful durable final.
    void close() {
        recognizer_.abort();
        clear_partial();
        sequence_ = 0;
    }

private:
    void clear_partial() {
        if (visible_) publish_(sequence_, start_, end_, false, "");
        visible_ = false;
    }

    Recognizer &recognizer_;
    Publish publish_;
    uint64_t sequence_ = 0, closed_sequence_ = 0, start_ = 0, end_ = 0;
    bool visible_ = false;
};
