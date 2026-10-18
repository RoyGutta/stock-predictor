"""Recent periodic and current reports from SEC's submissions index.

The submissions JSON stores filings column-wise (`filings.recent.form[i]`,
`filings.recent.filingDate[i]`, ...). SEC guarantees it covers at least the
last year or the last 1,000 filings, whichever is more; older filings live in
paged files this module deliberately does not fetch -- the link to the
company's EDGAR page covers the full history.

Links point at the original document on sec.gov. Nothing is mirrored.
"""

from __future__ import annotations

from typing import Any

from app.services.sec.client import ARCHIVES_URL

# The reports a reader of financial statements needs. Ownership forms (3/4/5),
# prospectuses, and proxy material are excluded on purpose: they dominate the
# raw list (Apple: 598 Form 4s in its recent index) and bury the reports.
REPORT_FORMS = {
    "10-K": "Annual report",
    "10-KT": "Annual transition report",
    "10-Q": "Quarterly report",
    "10-QT": "Quarterly transition report",
    "8-K": "Current report (material event)",
    "20-F": "Annual report (foreign private issuer)",
    "40-F": "Annual report (Canadian issuer)",
    "6-K": "Current report (foreign private issuer)",
}

# The 8-K items readers most often need translated. Unlisted items are shown
# by number only rather than with a guessed description.
EIGHT_K_ITEMS = {
    "1.01": "Entry into a material agreement",
    "1.02": "Termination of a material agreement",
    "1.05": "Material cybersecurity incident",
    "2.01": "Completion of an acquisition or disposition",
    "2.02": "Results of operations and financial condition",
    "2.03": "Creation of a direct financial obligation",
    "2.05": "Costs of exit or disposal activities",
    "2.06": "Material impairments",
    "3.01": "Delisting or listing-standard notice",
    "4.01": "Change in certifying accountant",
    "4.02": "Non-reliance on previously issued financial statements",
    "5.02": "Departure or appointment of directors or officers",
    "5.03": "Amendments to articles or bylaws; change in fiscal year",
    "5.07": "Shareholder vote results",
    "7.01": "Regulation FD disclosure",
    "8.01": "Other events",
    "9.01": "Financial statements and exhibits",
}

_COLUMNS = ("accessionNumber", "filingDate", "form")
_SUBMISSION_FIELDS = (
    "accessionNumber", "filingDate", "reportDate", "form", "items",
    "primaryDocument", "primaryDocDescription",
)


def base_form(form: str) -> str:
    return form[:-2] if form.endswith("/A") else form


def reduce_submissions(raw: Any) -> dict[str, Any]:
    """Keep only what the app shows; validate the column structure on the way."""
    recent = raw["filings"]["recent"]
    length = len(recent["form"])
    for column in _COLUMNS:
        if len(recent[column]) != length:
            raise ValueError(f"submissions column {column} has a different length")
    rows: list[dict[str, str]] = []
    for index in range(length):
        form = str(recent["form"][index])
        if base_form(form) not in REPORT_FORMS:
            continue
        row: dict[str, str] = {}
        for name in _SUBMISSION_FIELDS:
            column = recent.get(name) or []
            value = column[index] if index < len(column) else ""
            row[name] = str(value or "")
        rows.append(row)
    return {
        "cik": int(raw["cik"]),
        "name": str(raw.get("name") or ""),
        "tickers": [str(t) for t in raw.get("tickers") or []],
        "entity_type": raw.get("entityType") or None,
        "fiscal_year_end": raw.get("fiscalYearEnd") or None,
        "sic_description": raw.get("sicDescription") or None,
        "filings": rows,
        "has_older_pages": bool(raw["filings"].get("files")),
    }


def filing_urls(cik: int, accession: str, primary_document: str) -> tuple[str, str]:
    """(document URL, filing index URL) on sec.gov.

    The index page always exists; the primary document is preferred when SEC
    names one, because it is what a reader wants to open.
    """
    folder = f"{ARCHIVES_URL}/{cik}/{accession.replace('-', '')}"
    index_url = f"{folder}/{accession}-index.htm"
    document_url = f"{folder}/{primary_document}" if primary_document else index_url
    return document_url, index_url


def select_filings(
    reduced: dict[str, Any], forms: set[str] | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """Most recent first, filtered to base forms; amendments travel with their form."""
    wanted = forms or set(REPORT_FORMS)
    out: list[dict[str, Any]] = []
    for row in sorted(reduced["filings"], key=lambda r: r["filingDate"], reverse=True):
        form = row["form"]
        base = base_form(form)
        if base not in wanted:
            continue
        document_url, index_url = filing_urls(
            reduced["cik"], row["accessionNumber"], row["primaryDocument"]
        )
        items = [item.strip() for item in row["items"].split(",") if item.strip()]
        out.append(
            {
                "form": form,
                "base_form": base,
                "form_description": REPORT_FORMS[base],
                "amendment": form.endswith("/A"),
                "filing_date": row["filingDate"],
                # SEC uses the report date for the period covered; 8-Ks use the
                # event date. Empty means SEC recorded none.
                "report_date": row["reportDate"] or None,
                "accession_number": row["accessionNumber"],
                "items": [
                    {"code": code, "description": EIGHT_K_ITEMS.get(code)} for code in items
                ],
                "description": row["primaryDocDescription"] or None,
                "document_url": document_url,
                "index_url": index_url,
            }
        )
        if len(out) >= limit:
            break
    return out
