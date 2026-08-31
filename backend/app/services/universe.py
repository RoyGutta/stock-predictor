"""The curated exploration universe.

There is no market-wide screener on the free data tier (TENSIONS T-4), and
fabricating one would violate the project's first rule. The honest alternative
is a small, fixed, fully disclosed universe of large, liquid, well-known ETFs
spanning the major asset classes -- enough breadth for a beginner to see how
volatility, drawdown, diversification, and correlation differ across fund
types, without pretending to scan the whole market.

Only *categorical facts* live here: what each fund is and what it tracks.
These are stable, publicly documented properties of the funds themselves.
Every *numerical* characteristic (volatility, drawdown, return, momentum,
correlation) is computed from real price history at request time and is never
stored in this file.

The API response that uses this universe must say, verbatim, that it searched
a curated educational list and not the whole market.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class AssetClass(str, Enum):
    US_EQUITY = "US equity"
    INTERNATIONAL_EQUITY = "International equity"
    BONDS = "Bonds"
    REAL_ESTATE = "Real estate"
    COMMODITY = "Commodity"


class Breadth(str, Enum):
    """How widely a single fund spreads its holdings.

    A categorical fact about fund construction: an S&P 500 fund holds hundreds
    of companies across sectors; a sector fund concentrates in one industry; a
    single-commodity fund holds one thing. Used by the diversification
    criterion, and always shown to the user with this definition.
    """

    BROAD = "broad"
    SECTOR = "sector"
    SINGLE_ASSET = "single-asset"


@dataclass(frozen=True)
class Fund:
    ticker: str
    name: str
    asset_class: AssetClass
    breadth: Breadth
    category: str
    """One-line factual description of what the fund tracks."""
    tracks: str


UNIVERSE: tuple[Fund, ...] = (
    Fund("VOO", "Vanguard S&P 500 ETF", AssetClass.US_EQUITY, Breadth.BROAD,
         "Broad US market", "The S&P 500 index of large US companies."),
    Fund("VTI", "Vanguard Total Stock Market ETF", AssetClass.US_EQUITY, Breadth.BROAD,
         "Broad US market", "The entire US stock market, large through small."),
    Fund("QQQ", "Invesco QQQ Trust", AssetClass.US_EQUITY, Breadth.BROAD,
         "US growth / Nasdaq-100", "The Nasdaq-100: 100 large non-financial companies."),
    Fund("VIG", "Vanguard Dividend Appreciation ETF", AssetClass.US_EQUITY, Breadth.BROAD,
         "Dividend", "US companies with a history of raising dividends."),
    Fund("SCHD", "Schwab US Dividend Equity ETF", AssetClass.US_EQUITY, Breadth.BROAD,
         "Dividend", "High-dividend US stocks screened for fundamentals."),
    Fund("VEA", "Vanguard FTSE Developed Markets ETF", AssetClass.INTERNATIONAL_EQUITY,
         Breadth.BROAD, "International developed",
         "Large and mid caps in developed markets outside the US."),
    Fund("VWO", "Vanguard FTSE Emerging Markets ETF", AssetClass.INTERNATIONAL_EQUITY,
         Breadth.BROAD, "Emerging markets", "Stocks in emerging-market countries."),
    Fund("VXUS", "Vanguard Total International Stock ETF", AssetClass.INTERNATIONAL_EQUITY,
         Breadth.BROAD, "International total", "The entire stock market outside the US."),
    Fund("BND", "Vanguard Total Bond Market ETF", AssetClass.BONDS, Breadth.BROAD,
         "US bonds", "The broad US investment-grade bond market."),
    Fund("AGG", "iShares Core US Aggregate Bond ETF", AssetClass.BONDS, Breadth.BROAD,
         "US bonds", "The broad US investment-grade bond market."),
    Fund("SHY", "iShares 1-3 Year Treasury Bond ETF", AssetClass.BONDS, Breadth.BROAD,
         "Short-term treasuries", "US Treasury bonds maturing in one to three years."),
    Fund("TLT", "iShares 20+ Year Treasury Bond ETF", AssetClass.BONDS, Breadth.BROAD,
         "Long-term treasuries", "US Treasury bonds maturing in twenty-plus years."),
    Fund("VNQ", "Vanguard Real Estate ETF", AssetClass.REAL_ESTATE, Breadth.SECTOR,
         "Real estate", "US real-estate investment trusts."),
    Fund("GLD", "SPDR Gold Shares", AssetClass.COMMODITY, Breadth.SINGLE_ASSET,
         "Gold", "The price of gold bullion."),
    Fund("XLK", "Technology Select Sector SPDR", AssetClass.US_EQUITY, Breadth.SECTOR,
         "Technology", "Technology companies in the S&P 500."),
    Fund("XLV", "Health Care Select Sector SPDR", AssetClass.US_EQUITY, Breadth.SECTOR,
         "Healthcare", "Healthcare companies in the S&P 500."),
    Fund("XLF", "Financial Select Sector SPDR", AssetClass.US_EQUITY, Breadth.SECTOR,
         "Financials", "Financial companies in the S&P 500."),
    Fund("XLE", "Energy Select Sector SPDR", AssetClass.US_EQUITY, Breadth.SECTOR,
         "Energy", "Energy companies in the S&P 500."),
    Fund("XLP", "Consumer Staples Select Sector SPDR", AssetClass.US_EQUITY, Breadth.SECTOR,
         "Consumer staples", "Consumer-staples companies in the S&P 500."),
    Fund("XLU", "Utilities Select Sector SPDR", AssetClass.US_EQUITY, Breadth.SECTOR,
         "Utilities", "Utility companies in the S&P 500."),
)

UNIVERSE_NOTE = (
    f"Searched a curated educational list of {len(UNIVERSE)} large, liquid ETFs spanning "
    "the major asset classes -- not the whole market. The list is fixed and disclosed; "
    "a fund's absence means only that it is not on this list."
)

SECTOR_CATEGORIES: tuple[str, ...] = tuple(
    sorted({fund.category for fund in UNIVERSE if fund.breadth is Breadth.SECTOR})
)


def by_ticker() -> dict[str, Fund]:
    return {fund.ticker: fund for fund in UNIVERSE}
