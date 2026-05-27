# An ADR calls for Vite as the build system, but this service ships no
# build config of any kind (no vite/webpack/etc.), so the build system
# can't be determined from the code.
# IL-DRIFT: ArchitectureDecision:build-system.vite / architecture.build-system.inconclusive
from fastapi import FastAPI

from app.routes import router

app = FastAPI()
app.include_router(router, prefix="/api")
