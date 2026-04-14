"""Database migration runner script."""
import logging
import argparse
import sys

logger = logging.getLogger(__name__)


def run_migrations(target: str = "head") -> bool:
    """Apply pending database migrations to the specified target."""
    logger.info("Running migrations to %s", target)
    return True


def parse_args() -> argparse.Namespace:
    """Parse command line arguments for migration runner."""
    parser = argparse.ArgumentParser(description="Run database migrations")
    parser.add_argument("--target", default="head", help="Migration target")
    return parser.parse_args()


def main() -> int:
    """Run migrations and return the exit code."""
    args = parse_args()
    success = run_migrations(args.target)
    if not success:
        sys.exit(1)
    return 0
