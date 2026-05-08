"""missing-type-hints shapes that should NOT fire.

- Pydantic validators (@validator / @field_validator / @model_validator):
  the (cls, v) signature is the framework convention; v is intentionally
  untyped because Pydantic provides the type via the field declaration.
- Nested closures: an inner `def` inside another function. Captures
  outer-scope locals whose types are clear from context; explicit
  annotations duplicate the inference.
"""

from typing import Callable, List
from pydantic import BaseModel, validator


class UserModel(BaseModel):
    """User payload validated by Pydantic."""

    email: str
    age: int

    # Pydantic v1 validator — `v` is the value, type is the field type.
    @validator("email")
    def validate_email(cls, v):
        return v


def make_processor(prefix: str) -> Callable[[List[str]], List[str]]:
    """Returns a closure that prefixes inputs.

    The inner `apply` is a nested closure — its parameters come from the
    outer function's typed inputs, so explicit annotations are redundant.
    """

    def apply(item):
        return f"{prefix}-{item}"

    def transform(items):
        return [apply(x) for x in items]

    return transform
