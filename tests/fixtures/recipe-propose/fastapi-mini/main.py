"""A minimal FastAPI app: one health route and one business route, so the health
path is RANKED over a real surface rather than assumed."""

from fastapi import FastAPI

app = FastAPI()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/forecast")
def forecast() -> dict[str, str]:
    return {"forecast": "sunny"}
