"""Versioned native latency gates; candidate qualification remains stricter."""

import math
import re

OPTIMIZATION_FIRST_TEXT_SECONDS = 3.0
RELEASE_FIRST_TEXT_SECONDS = 5.0
FINAL_TEXT_SECONDS = 4.4
RELEASE_POLICY = "production-first-text-5s-2026-10-20"
CANDIDATE_POLICY = "candidate-first-text-3s-v1"
ALPHA_POLICY = "alpha-first-text-advisory-2026-10-24"


def latency_policy(candidate=False):
    return {
        "id": CANDIDATE_POLICY if candidate else RELEASE_POLICY,
        "firstTextP95Seconds": OPTIMIZATION_FIRST_TEXT_SECONDS if candidate else RELEASE_FIRST_TEXT_SECONDS,
        "firstTextOptimizationTargetSeconds": OPTIMIZATION_FIRST_TEXT_SECONDS,
        "finalAfterVadEndP95Seconds": FINAL_TEXT_SECONDS,
    }


def release_decision(checks, first_text_seconds, release_tag="", candidate=False):
    required = {"completeRegression", "textProduced", "firstText", "finalText", "memoryPeak"}
    if set(checks) != required or any(type(value) is not bool for value in checks.values()):
        return {"allowed": False, "advisoryChecks": [], "blockingChecks": ["invalidReport"]}
    failed = sorted(key for key, passed in checks.items() if not passed)
    version = r"(0|[1-9][0-9]*)"
    alpha = re.fullmatch(rf"v{version}\.{version}\.{version}-alpha\.{version}", release_tag)
    measured_overrun = (type(first_text_seconds) in (int, float)
                        and math.isfinite(first_text_seconds)
                        and first_text_seconds > RELEASE_FIRST_TEXT_SECONDS)
    advisory = (["firstText"] if alpha and not candidate and measured_overrun
                and "firstText" in failed else [])
    blocking = [key for key in failed if key not in advisory]
    return {"allowed": not blocking, "advisoryChecks": advisory, "blockingChecks": blocking,
            "policy": ALPHA_POLICY if alpha and not candidate else latency_policy(candidate)["id"]}
