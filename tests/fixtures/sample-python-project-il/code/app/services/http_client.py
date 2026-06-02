# Spec mandates migrating off the deprecated `requests` package to httpx.
# It is still declared in requirements.txt and used here.
# IL-DRIFT: ForbiddenArtifact:deprecated-http-client / forbidden.dependency.requests.present
import requests


def fetch_legacy(url: str) -> str:
    return requests.get(url).text
