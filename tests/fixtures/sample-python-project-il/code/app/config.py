"""Application runtime configuration via environment-backed settings.

Pydantic BaseSettings fields are exposed to the environment under their
validation_alias names. The spec tracks configurable constants by those
canonical env-alias names.
"""

from pydantic import AliasChoices, AliasPath, Field
from pydantic_settings import BaseSettings


class JobSettings(BaseSettings):
    """Settings controlling background job execution."""

    # FP-GUARD: named-constant/no-code-counterpart — must NOT drift
    # The spec refers to this constant by its env alias APP_JOBS_RETRY_BUDGET_SECONDS.
    # The field's validation_alias provides that alias; the extractor must lift it
    # from the Field call rather than require a bare module-level assignment.
    retry_budget_seconds: float = Field(
        default=45.0,
        description="Maximum cumulative seconds a job may spend retrying.",
        validation_alias=AliasChoices(
            AliasPath("retry_budget_seconds"),
            "app_jobs_retry_budget_seconds",
        ),
    )

    # The spec names the pending-task ceiling TASK_QUEUE_MAX_PENDING = 500.
    # The code stores this under a different env namespace (app.workers.*);
    # no alias matches the spec name, so the constant is genuinely absent by name.
    # IL-DRIFT: NamedConstant:TASK_QUEUE_MAX_PENDING / constant.TASK_QUEUE_MAX_PENDING.no-code-counterpart
    worker_limit: int = Field(
        default=500,
        description="Maximum tasks permitted in the pending queue.",
        validation_alias=AliasChoices(
            AliasPath("worker_limit"),
            "app_workers_concurrency_limit",
        ),
    )
