"""Versioned native latency gates; candidate qualification remains stricter."""

OPTIMIZATION_FIRST_TEXT_SECONDS = 3.0
RELEASE_FIRST_TEXT_SECONDS = 5.0
FINAL_TEXT_SECONDS = 4.4
RELEASE_POLICY = "production-first-text-5s-2026-10-20"
CANDIDATE_POLICY = "candidate-first-text-3s-v1"


def latency_policy(candidate=False):
    return {
        "id": CANDIDATE_POLICY if candidate else RELEASE_POLICY,
        "firstTextP95Seconds": OPTIMIZATION_FIRST_TEXT_SECONDS if candidate else RELEASE_FIRST_TEXT_SECONDS,
        "firstTextOptimizationTargetSeconds": OPTIMIZATION_FIRST_TEXT_SECONDS,
        "finalAfterVadEndP95Seconds": FINAL_TEXT_SECONDS,
    }
