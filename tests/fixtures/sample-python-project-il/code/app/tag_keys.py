"""
FP-guard for `py-constant-cluster` shape (synthesized enum from a value-prefix
cluster of module-level string constants).

Pattern naturalised from real OSS — Dagster's `_core/storage/tags.py` builds
each documented automatic-run-tag from one shared prefix constant via f-string:

    SYSTEM_TAG_PREFIX = "dagster"
    SCHEDULE_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/schedule_name"
    ...

A spec enum then lists the *values* (not the constant names). Without f-string
resolution + cluster synthesis those values look absent from the code and the
verifier fires `no-code-counterpart`. With both the extractor synthesizes one
enum `(value-prefix)` whose values match the contract — no drift.
"""

# Shared namespace prefix — every constant below builds off it.
SYSTEM_TAG_PREFIX = "sample-app"

# Tag keys — each f-string MUST resolve through the prefix table to a literal
# value at extraction time. The cluster synthesis groups them by shared value
# prefix (`sample-app/`).
SCHEDULE_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/schedule_name"
PARTITION_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/partition"
USER_TAG = f"{SYSTEM_TAG_PREFIX}/user"
CODE_LOCATION_TAG = f"{SYSTEM_TAG_PREFIX}/code_location"
PARENT_RUN_ID_TAG = f"{SYSTEM_TAG_PREFIX}/parent_run_id"
SENSOR_NAME_TAG = f"{SYSTEM_TAG_PREFIX}/sensor_name"


def all_tag_keys() -> tuple[str, ...]:
    """Used in production to enumerate every reserved tag — keeps the
    constants referenced so a future linter doesn't strip them."""
    return (
        SCHEDULE_NAME_TAG,
        PARTITION_NAME_TAG,
        USER_TAG,
        CODE_LOCATION_TAG,
        PARENT_RUN_ID_TAG,
        SENSOR_NAME_TAG,
    )
