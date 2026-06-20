"""A release helper that lives in cli/ and is meant to be run directly as
``./release_entrypoint_no_shebang.py``. It is a genuine executable script, but
the author forgot the shebang line, so the kernel cannot pick an interpreter.
"""
import sys


def publish(tag):
    print(f"publishing {tag}")
    return 0


# VIOLATION: reliability/deterministic/shebang-error
if __name__ == "__main__":
    sys.exit(publish(sys.argv[1]))
