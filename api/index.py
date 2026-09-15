"""Vercel entry point for the public demo.

Vercel runs this file as a Python serverless function and serves the built
frontend as static files; `vercel.json` rewrites `/api/*` and `/health` here.
The environment defaults below exist so the demo can be deployed with no
configuration and no secrets. Any real environment variable set on the Vercel
project overrides them.

DEMO_MODE is forced on for this entry point on purpose: the default price
provider is not licensed for public display (PROVIDERS.md), so the public
deployment serves only the clearly labeled synthetic dataset.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

os.environ["DEMO_MODE"] = "1"
os.environ.setdefault("APP_ENV", "production")

# Same-origin deployment: the browser never makes a cross-origin call, but the
# production config validator still requires an explicit, non-wildcard list.
_hosts = [os.getenv("VERCEL_PROJECT_PRODUCTION_URL", ""), os.getenv("VERCEL_URL", "")]
os.environ.setdefault(
    "CORS_ALLOWED_ORIGINS",
    ",".join(f"https://{host}" for host in _hosts if host) or "https://stock-predictor.vercel.app",
)

from app.main import app  # noqa: E402  (path and environment must be set first)

__all__ = ["app"]
