"""Boundaries the refactor exists to create, pinned so they cannot erode.

A vendor may be named in exactly one place: its adapter. Analytics, routes, the
service, and the app entry point are vendor-neutral, and a provider swap is a
registry entry, not a search-and-replace.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
ADAPTER = APP / "services" / "providers" / "yahoo.py"


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _python_files(*parts: str) -> list[Path]:
    return sorted((APP.joinpath(*parts)).rglob("*.py"))


def test_only_the_adapter_imports_yfinance() -> None:
    offenders = [
        str(path.relative_to(APP))
        for path in _python_files()
        if path != ADAPTER and any(name.split(".")[0] == "yfinance" for name in _imports(path))
    ]
    assert offenders == [], offenders
    assert any(name == "yfinance" for name in _imports(ADAPTER))


def test_analytics_know_no_provider() -> None:
    for path in _python_files("analytics"):
        names = _imports(path)
        assert not any(n.startswith("app.services") for n in names), (path.name, names)
        assert "yfinance" not in names


def test_routes_and_service_do_not_import_a_vendor_adapter() -> None:
    for path in [*_python_files("routes"), APP / "services" / "market_data.py", APP / "main.py"]:
        names = _imports(path)
        assert "app.services.providers.yahoo" not in names, path.name
        assert "yfinance" not in names, path.name


def test_adjustment_basis_reaches_the_api_schema() -> None:
    from app.schemas import Quote

    assert "adjustment" in Quote.model_fields
