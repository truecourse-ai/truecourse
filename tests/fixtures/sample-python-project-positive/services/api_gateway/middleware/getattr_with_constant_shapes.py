"""getattr-with-constant shape that should NOT fire.

`setattr(record, "<field>", value)` on a stdlib `LogRecord` is
the canonical pattern for adding custom fields — logging
filters / formatters discover fields via `record.__dict__` /
`getattr(record, name)`, and stdlib documentation explicitly
shows the setattr form. Direct attribute assignment
(`record.<field> = value`) works the same, but the setattr
form is conventional and shadows nothing if the field name is
later parameterized.
"""

import logging


class StackInfoFilter(logging.Filter):
    """Inject the current request's correlation id into every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        setattr(record, "correlation_id", "stub")
        setattr(record, "tenant_id", "demo")
        return True
