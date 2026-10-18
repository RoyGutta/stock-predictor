import { useState } from "react";

import { fetchSecFilings, fetchSecFundamentals } from "../../lib/api";
import type { Capabilities } from "../../types/market";
import type {
  FilingsResponse,
  FundamentalsPeriod,
  FundamentalsResponse,
} from "../../types/sec";
import { CapabilityNotice } from "../market/MarketPanels";
import { FilingsPanel } from "./FilingsPanel";
import { FundamentalsPanel } from "./FundamentalsPanel";
import { useSecResource } from "./useSec";
import "./sec.css";

/**
 * SEC filings and reported financials for the security on the Analyze page.
 *
 * This is a different kind of data from the price chart: official company
 * reports about past periods. In the public demo the prices are synthetic
 * while these are real, and the page says so in as many words.
 */
export function SecSection({
  ticker,
  capabilities,
}: {
  ticker: string;
  capabilities: Capabilities;
}) {
  // A company found by name replaces the ticker until another ticker is loaded.
  const [chosen, setChosen] = useState<{
    ticker: string;
    query: string;
  } | null>(null);
  const [period, setPeriod] = useState<FundamentalsPeriod>("annual");
  const enabled = capabilities.sec_filings ?? false;
  const query = chosen && chosen.ticker === ticker ? chosen.query : ticker;

  const filings = useSecResource<FilingsResponse>(
    enabled ? query : null,
    (signal) => fetchSecFilings(query, signal),
  );
  const fundamentals = useSecResource<FundamentalsResponse>(
    enabled ? `${query}:${period}` : null,
    (signal) => fetchSecFundamentals(query, period, signal),
  );

  if (!enabled) {
    return (
      <CapabilityNotice
        title="SEC filings and reported financials"
        note={
          capabilities.notes.sec_filings ??
          "SEC filings are not enabled on this server."
        }
      />
    );
  }

  return (
    <>
      <p className="sec__divider">
        <strong>Company reports from the SEC.</strong>{" "}
        {capabilities.demo
          ? "Unlike the synthetic price chart above, the filings and figures below are this company's actual reports to the U.S. Securities and Exchange Commission. They describe the periods shown, not today."
          : "The filings and figures below are this company's own reports to the U.S. Securities and Exchange Commission. They describe the periods shown, not today, and are separate from the price data above."}
      </p>
      <FilingsPanel
        state={filings}
        query={ticker}
        onChooseCompany={(next) => setChosen({ ticker, query: next })}
      />
      {filings.status !== 404 && (
        <FundamentalsPanel
          state={fundamentals}
          period={period}
          onPeriodChange={setPeriod}
        />
      )}
    </>
  );
}
