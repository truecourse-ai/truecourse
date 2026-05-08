"""unnecessary-placeholder-statement shape that should NOT fire.

`pass` next to an inline explanatory comment in `except` /
`elif` / `else` body. The comment explains why the branch is
intentionally a no-op; the `pass` is the executable
placeholder. Removing `pass` would leave only the comment in
the block — not an executable statement.
"""

import binascii


def decrypt(value: str) -> str:
    """Best-effort legacy-format decode."""
    try:
        return value.encode("ascii").decode("base64")
    except binascii.Error:
        pass  # Key is in legacy format; fall through to plain return.
    except UnicodeDecodeError:
        pass  # Value is not ASCII; treat as already decoded.
    return value
