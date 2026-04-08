"""Utility with consistent indentation."""


def process_data(items: list[object]) -> list[object]:
    """Process a list of data items and return them unchanged."""
    return [item for item in items]


def transform_values(values: list[float]) -> list[float]:
    """Double each value in the input list."""
    return [v * 2 for v in values]
