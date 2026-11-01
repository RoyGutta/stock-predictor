import { Card } from "../components/ui";
import { ScreenerPanel } from "../features/screener/ScreenerPanel";
import { useCapabilities } from "../hooks/useMarketData";

/**
 * Research: screens over figures companies reported to the SEC. Produces
 * research candidates to read about, never recommendations, and uses no prices.
 */
export function ResearchPage() {
  const capabilities = useCapabilities();
  const enabled = capabilities.data?.sec_filings ?? false;
  return (
    <div className="page">
      <Card>
        <div className="welcome">
          <h1 className="welcome__title">Research</h1>
          <p className="welcome__body">
            Narrow U.S. public companies by what they reported to the SEC:
            revenue, growth, margins, cash flow, and leverage. The results are a
            starting list for reading filings, not a ranking of investments.
          </p>
        </div>
      </Card>
      <ScreenerPanel
        enabled={enabled}
        note={capabilities.data?.notes.sec_filings}
      />
    </div>
  );
}
