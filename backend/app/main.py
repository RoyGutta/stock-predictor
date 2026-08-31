"""FastAPI application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.middleware.rate_limit import RateLimitMiddleware
from app.routes import analysis, backtest, compare, market, portfolio, simulation, stocks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)

# Note: httpx/httpcore log levels are raised in app.services.providers.base,
# where the requests are actually made -- see the comment there.

logger = logging.getLogger(__name__)

settings = get_settings()

DESCRIPTION = """
Educational market data and technical analysis API.

**This API provides historical analysis, not predictions.** Every value it
returns describes past price behavior. Nothing here is investment advice.
"""

app = FastAPI(
    title="Stock Predictor API",
    description=DESCRIPTION,
    version="0.2.0",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
)

# Explicit origin allowlist. Never "*" -- that would let any site on the
# internet call this API from a visitor's browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)

app.add_middleware(RateLimitMiddleware, requests_per_minute=settings.rate_limit_per_minute)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log the real error, return an opaque one.

    The previous implementation returned `str(e)` to the caller, which leaked
    file paths and library internals to anyone who could trigger an error.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred."},
    )


@app.get("/health", tags=["system"], summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version, "environment": settings.app_env}


app.include_router(stocks.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")
app.include_router(market.router, prefix="/api/v1")
app.include_router(backtest.router, prefix="/api/v1")
app.include_router(simulation.router, prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(compare.router, prefix="/api/v1")
