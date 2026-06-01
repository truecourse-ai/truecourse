import json
from pathlib import Path

# Spec forbids FEATURE_EXPORT_V2 from any shipped config — the data-export
# feature is GA, so the flag must be removed. It still ships in
# config/features.json.
# IL-DRIFT: ForbiddenArtifact:feature-experimental-export / forbidden.feature-flag.FEATURE_EXPORT_V2.present


def load_flags() -> dict:
    path = Path(__file__).resolve().parents[2] / "config" / "features.json"
    return json.loads(path.read_text())
