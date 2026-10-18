#include "preview_schedule.h"
#include <cstdlib>

static void check(bool value) { if (!value) std::abort(); }

int main() {
    PreviewSchedule schedule(16000);
    check(!schedule.due(15999));
    check(schedule.due(16000));
    schedule.attempted(16000, false);
    // Busy inference neither triggers a per-frame retry nor loses a full interval.
    check(!schedule.due(16512));
    check(!schedule.due(17999));
    check(schedule.due(18000));
    schedule.attempted(18000, true);
    check(!schedule.due(49999));
    check(schedule.due(50000));
    schedule.attempted(50000, true);
    check(!schedule.due(50001));
    schedule.reset();
    check(!schedule.due(512));
    check(schedule.due(16384));
    schedule.attempted(16384, true);
    check(!schedule.due(48383));
    check(schedule.due(48384));
    schedule.reset();
    int attempts = 0;
    for (size_t samples = 512; samples < 16000 * 15; samples += 512)
        if (schedule.due(samples)) { schedule.attempted(samples, true); ++attempts; }
    check(attempts == 7);
}
