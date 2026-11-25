"""Main FastAPI application entry point."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import settings
from app.routers import upload, process, visualize
from app.services.gee_service import initialize_earth_engine, is_gee_initialized

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting RUSLE Web Application...")
    settings.ensure_directories()
    try:
        initialize_earth_engine(settings.gee_project)
        logger.info("Google Earth Engine initialized successfully.")
    except Exception as exc:
        # Keep the API available so its health endpoint and diagnostics remain
        # accessible. GEE-dependent analysis routes should report unavailable.
        logger.error("GEE initialization failed: %s", exc)
    yield
    logger.info("Shutting down RUSLE Web Application...")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Web application for calculating soil loss using the "
        "Revised Universal Soil Loss Equation (RUSLE)"
    ),
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")
templates = Jinja2Templates(directory=str(settings.templates_dir))
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(process.router, prefix="/api", tags=["process"])
app.include_router(visualize.router, prefix="/api", tags=["visualize"])


@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app")


@app.get("/app")
async def main_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"title": settings.app_name},
    )


@app.get("/health")
async def health_check():
    # Do not fail Render's process health check solely because GEE credentials
    # are misconfigured; expose GEE status separately for diagnosis.
    gee_ok = is_gee_initialized()
    return {
        "status": "healthy",
        "version": settings.app_version,
        "gee_initialized": gee_ok,
        "gee_status": "ready" if gee_ok else "unavailable",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "10000")),
        reload=settings.debug,
        workers=1,
    )
