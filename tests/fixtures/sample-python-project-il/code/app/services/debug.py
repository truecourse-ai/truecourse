import os

# Spec forbids any debug env-var in production builds. PROD_DEBUG gates
# verbose request logging and must not be read.
# IL-DRIFT: ForbiddenArtifact:prod-debug-env / forbidden.env-var.PROD_DEBUG.present
DEBUG_MODE = os.environ.get("PROD_DEBUG") == "true"


def debug_log(*args) -> None:
    if DEBUG_MODE:
        print("[debug]", *args)
