"""Outbound job-event notifier.

A third-party notifier integration (configured out-of-repo) documents the job
events it can fire on; this module only decides which job statuses count as
"finished" so a single terminal notification is sent per run.
"""


# FP-GUARD: enum/missing-value — must NOT drift
# `FINISHED_JOB_STATUSES` is the deliberate terminal slice of the run-status
# family — it omits the in-flight RUNNING status by design.  The notifier
# integration's spec enum (succeeded/failed/canceled/running) has no code-side
# enum of its own and is value-matched to this finished subset; RUNNING's
# absence from a *finished* set is expected, not a missing implementation, so it
# must NOT drift.
FINISHED_JOB_STATUSES = {"SUCCEEDED", "FAILED", "CANCELED"}


def is_finished(status: str) -> bool:
    return status in FINISHED_JOB_STATUSES


# Regression guard against over-suppression: `VALID_WORKER_PHASES` value-matches
# the spec's `scheduler.run-phases` enum but is NOT a subset of it — it both
# omits `PAUSED` and introduces `HALTED`.  That genuine divergence must still
# drift, for both the missing and the extra value.
# IL-DRIFT: Enum:scheduler.run-phases / enum.scheduler.run-phases.missing-value.PAUSED
# IL-DRIFT: Enum:scheduler.run-phases / enum.scheduler.run-phases.extra-value.HALTED
VALID_WORKER_PHASES = ["PENDING", "ACTIVE", "HALTED", "DONE"]
