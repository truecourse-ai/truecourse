"""Centralized logging configuration."""

import logging
import sys


LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
DEFAULT_LEVEL = logging.INFO


def create_logger(name: str, level: int = DEFAULT_LEVEL) -> logging.Logger:
    """Create a configured logger with a stream handler.

    Args:
        name: The logger name, typically the module name.
        level: The logging level threshold.

    Returns:
        A configured Logger instance.
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setLevel(level)
        formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    return logger


def set_log_level(logger: logging.Logger, level: int) -> None:
    """Update the log level for a logger and all its handlers.

    Args:
        logger: The logger to update.
        level: The new logging level.
    """
    logger.setLevel(level)
    for handler in logger.handlers:
        handler.setLevel(level)
