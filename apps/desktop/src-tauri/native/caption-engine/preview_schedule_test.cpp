#include "preview_schedule.h"
#include <cstdlib>

static void check(bool value) { if (!value) std::abort(); }

int main() {
    PreviewSchedule schedule(16000);
    check(!schedule.due(23999));
    check(schedule.due(24000));
    schedule.attempted(24000, false);
    // Busy inference neither triggers a per-frame retry nor loses a full interval.
    check(!schedule.due(24512));
    check(!schedule.due(25999));
    check(schedule.due(26000));
    schedule.attempted(26000, true);
    check(!schedule.due(57999));
    check(schedule.due(58000));
    schedule.attempted(58000, true);
    check(!schedule.due(58001));
    schedule.reset();
    check(!schedule.due(512));
    check(schedule.due(24064));
    schedule.attempted(24064, true);
    check(!schedule.due(56000));
    check(schedule.due(56064));
    schedule.reset();
    int attempts = 0;
    for (size_t samples = 512; samples < 16000 * 15; samples += 512)
        if (schedule.due(samples)) { schedule.attempted(samples, true); ++attempts; }
    check(attempts == 7);
}
