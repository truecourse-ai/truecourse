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
