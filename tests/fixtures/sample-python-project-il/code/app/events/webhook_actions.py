"""Webhook automation actions — a discriminated union of Pydantic models."""

from typing import Literal, Union

from pydantic import BaseModel


# FP-GUARD: enum/no-code-counterpart — must NOT drift
# Each action carries a string `type` discriminator; the union below ties them
# together. The verifier must synthesize a `WebhookActionTypes` enum from the
# discriminator literals so the spec's WebhookActionType enum has a counterpart.
class SendEmail(BaseModel):
    type: Literal["send-email"] = "send-email"

class PostMessage(BaseModel):
    type: Literal["post-message"] = "post-message"

class OpenTicket(BaseModel):
    type: Literal["open-ticket"] = "open-ticket"

class RunScript(BaseModel):
    type: Literal["run-script"] = "run-script"


WebhookActionTypes = Union[SendEmail, PostMessage, OpenTicket, RunScript]


# FP-GUARD: enum/missing-value — must NOT drift
# Escalation actions are another discriminated union. Two of them — `page-oncall`
# and `open-incident` — are only available on the managed/cloud tier; the spec
# captures that via a `cloud-only` trigger-subset. This self-hosted build ships
# `open-incident` but deliberately omits `page-oncall` (a cloud-gated capability
# implemented only in the hosted backend). A value the spec marks cloud-only and
# that is absent from the self-hosted union must NOT be reported as a missing
# implementation — its omission is expected, not a divergence.
class NotifyTeam(BaseModel):
    type: Literal["notify-team"] = "notify-team"

class ReassignTicket(BaseModel):
    type: Literal["reassign-ticket"] = "reassign-ticket"

class PostUpdate(BaseModel):
    type: Literal["post-update"] = "post-update"

class OpenIncident(BaseModel):  # cloud-only capability that this build does ship
    type: Literal["open-incident"] = "open-incident"


EscalationActionTypes = Union[NotifyTeam, ReassignTicket, PostUpdate, OpenIncident]

# Cloud-only escalation capabilities the platform recognizes — used to hide
# actions that are unavailable on self-hosted installs.
CLOUD_ONLY_ESCALATION_TYPES = {"page-oncall", "open-incident"}


# Integration channels — also a discriminated union, also carrying a `cloud-only`
# trigger-subset (`datadog`/`pagerduty` are managed-tier only). Unlike the
# escalation union above, this build is missing `email`, an ORDINARY (non-gated)
# channel the spec requires — a genuine omission that must still drift even though
# the enum has a cloud-only subset.
# IL-DRIFT: Enum:IntegrationChannelType / enum.IntegrationChannelType.missing-value.email
class WebhookChannel(BaseModel):
    type: Literal["webhook"] = "webhook"

class SlackChannel(BaseModel):
    type: Literal["slack"] = "slack"

class PagerDutyChannel(BaseModel):
    type: Literal["pagerduty"] = "pagerduty"

class DatadogChannel(BaseModel):
    type: Literal["datadog"] = "datadog"


IntegrationChannelTypes = Union[WebhookChannel, SlackChannel, PagerDutyChannel, DatadogChannel]

# Cloud-only integration channels recognized by the platform.
CLOUD_ONLY_CHANNEL_TYPES = {"datadog", "pagerduty"}
