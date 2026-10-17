#include "recognition_queue.h"
#include <cstdlib>
#include <future>
#include <iostream>

static void check(bool value) { if (!value) std::abort(); }
static RecognitionJob final_job(uint64_t sequence, size_t count) {
    return {std::vector<float>(count, float(sequence)), sequence, sequence * 100, sequence * 100 + count, true};
}

int main() {
    {
        RecognitionQueue queue(20);
        check(queue.offer_partial({1, 2}, 1, 0, 2));
        check(!queue.offer_partial({1, 2, 3}, 1, 0, 3));
        auto job = queue.take();
        check(job && !job->final);
        check(!queue.offer_partial({1, 2, 3, 4}, 1, 0, 4));
        check(queue.submit_final(final_job(1, 5)));
        check(queue.cancelled(false));
        check(!queue.cancelled(true));
        queue.complete();
        job = queue.take();
        check(job && job->final && job->samples.size() == 5);
        check(!queue.cancelled(true));
        queue.complete();
        queue.close();
        check(!queue.take());
    }
    {
        RecognitionQueue queue(10);
        check(queue.offer_partial({1, 2}, 1, 0, 2));
        check(queue.submit_final(final_job(1, 6)));
        check(queue.submit_final(final_job(2, 4)));
        check(!queue.submit_final(final_job(3, 1)));
        check(!queue.offer_partial({1}, 3, 0, 1));
        queue.close();
        for (uint64_t sequence = 1; sequence <= 2; ++sequence) {
            auto job = queue.take();
            check(job && job->final && job->sequence == sequence);
            for (float value : job->samples) check(value == float(sequence));
            queue.complete();
        }
        check(!queue.take());
        check(!queue.submit_final(final_job(3, 1)));
    }
    {
        RecognitionQueue queue(10);
        check(!queue.submit_final(final_job(1, 11)));
        check(!queue.submit_final(final_job(1, 0)));
        check(!queue.offer_partial(std::vector<float>(11), 1, 0, 11));
        auto waiting = std::async(std::launch::async, [&] { return queue.take(); });
        queue.abort();
        check(!waiting.get());
        check(queue.cancelled(true));
    }
    {
        RecognitionQueue queue(10);
        check(queue.submit_final(final_job(1, 10)));
        queue.abort();
        check(!queue.take());
    }
    {
        RecognitionQueue queue(20);
        check(queue.offer_partial({1, 2}, 1, 0, 2));
        std::promise<void> entered, release;
        auto released = release.get_future();
        auto decoding = std::async(std::launch::async, [&] {
            auto job = queue.take();
            check(job && !job->final);
            entered.set_value();
            released.wait();
            check(queue.cancelled(job->final));
            queue.complete();
        });
        entered.get_future().wait();
        check(!queue.offer_partial({1, 2, 3}, 1, 0, 3));
        check(queue.submit_final(final_job(1, 10)));
        release.set_value();
        decoding.get();
        queue.close();
        check(queue.take()->final);
        queue.complete();
        check(!queue.take());
    }
    {
        RecognitionQueue queue(10);
        auto waiting = std::async(std::launch::async, [&] { return queue.take(); });
        check(queue.submit_final(final_job(1, 10)));
        check(waiting.get()->sequence == 1);
        queue.complete();
        check(queue.submit_final(final_job(2, 10)));
        queue.close();
        check(queue.take()->sequence == 2);
        queue.complete();
        check(!queue.take());
    }
    std::cout << "Recognition queue: partial suppression, final priority, bounded overload, drain, abort and wakeup PASS\n";
}
