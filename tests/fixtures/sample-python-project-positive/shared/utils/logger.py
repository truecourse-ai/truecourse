"""Centralized logger for the shared utilities module."""
import logging


class Logger:
    """Application logger that wraps the standard logging module."""

    def __init__(self) -> None:
        self._logger = logging.getLogger("shared")

    def info(self, message: str, *args: object) -> None:
        """Log an informational message."""
        self._logger.info(message, *args)

    def error(self, message: str, *args: object) -> None:
        """Log an error message."""
        self._logger.error(message, *args)

    def warn(self, message: str, *args: object) -> None:
        """Log a warning message."""
        self._logger.warning(message, *args)


logger = Logger()
