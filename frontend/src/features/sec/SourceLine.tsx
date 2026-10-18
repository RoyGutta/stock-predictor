import { Callout } from "../../components/ui";
import type { SecCompany, SecProvenance } from "../../types/sec";
import { formatRetrieved } from "./secFormat";

/**
 * Where an SEC figure came from and how fresh this copy is. Shown at the top
 * of every SEC panel, and never collapsed: provenance is the point of the data.
 */
export function SourceLine({
  provenance,
  company,
  latestFiled,
}: {
  provenance: SecProvenance;
  company: SecCompany;
  latestFiled?: string | null;
}) {
  return (
    <>
      <p className="sec__source">
        Source: {provenance.source}. {company.name ?? "Filer"}, CIK{" "}
        {company.cik_padded}.
        {latestFiled ? ` Latest filing used: ${latestFiled}.` : ""} Retrieved
        from SEC {formatRetrieved(provenance.retrieved_at)}.{" "}
        <a href={company.edgar_url} target="_blank" rel="noopener noreferrer">
          Company page on EDGAR
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
      {provenance.stale && (
        <Callout tone="note">
          SEC could not be reached just now
          {provenance.stale_reason ? ` (${provenance.stale_reason})` : ""}.
          Showing the copy retrieved {formatRetrieved(provenance.retrieved_at)};
          newer filings may be missing.
        </Callout>
      )}
    </>
  );
}
