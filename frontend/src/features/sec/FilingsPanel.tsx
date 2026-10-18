import { useState, type FormEvent } from "react";

import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { searchSecCompanies } from "../../lib/api";
import type { FilingsResponse, SecSearchResponse } from "../../types/sec";
import { formatFiscalYearEnd } from "./secFormat";
import { SourceLine } from "./SourceLine";
import { useSecResource, type SecState } from "./useSec";
import "./sec.css";

interface FilingsPanelProps {
  state: SecState<FilingsResponse>;
  query: string;
  onChooseCompany: (query: string) => void;
}

/**
 * The company's recent reports, each linked to the original on sec.gov.
 *
 * Only the reports a reader of financial statements needs are listed (annual,
 * quarterly, current); ownership and offering paperwork would bury them.
 */
export function FilingsPanel({
  state,
  query,
  onChooseCompany,
}: FilingsPanelProps) {
  const { data, loading, error, status } = state;

  if (error) {
    return (
      <Card title="SEC filings">
        <Callout tone="note">{error}</Callout>
        {status === 404 && (
          <CompanyLookup ticker={query} onChoose={onChooseCompany} />
        )}
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card title="SEC filings">
        <div className="sec__loading" aria-busy="true">
          <Skeleton height={18} />
          <Skeleton height={18} />
          <Skeleton height={18} />
        </div>
      </Card>
    );
  }

  const fiscal = formatFiscalYearEnd(data.company.fiscal_year_end);

  return (
    <Card
      title="SEC filings"
      action={<span className="eyebrow">Official reports</span>}
    >
      <SourceLine provenance={data} company={data.company} />
      {fiscal && (
        <p className="sec__meta">
          Fiscal year ends {fiscal}
          {data.company.industry ? ` · ${data.company.industry}` : ""}
        </p>
      )}

      {data.filings.length === 0 ? (
        <p className="sec__empty">
          No annual, quarterly, or current reports are in SEC&rsquo;s
          recent-filings index for this filer.
        </p>
      ) : (
        <ul className="sec-filings">
          {data.filings.map((filing) => (
            <li key={filing.accession_number} className="sec-filing">
              <span className="sec-filing__form">{filing.form}</span>
              <div className="sec-filing__body">
                <p className="sec-filing__title">
                  {filing.form_description}
                  {filing.amendment && (
                    <span className="sec-tag">Amendment</span>
                  )}
                </p>
                <p className="sec-filing__dates">
                  Filed {filing.filing_date}
                  {filing.report_date &&
                    (filing.base_form === "8-K" || filing.base_form === "6-K"
                      ? ` · event ${filing.report_date}`
                      : ` · period ended ${filing.report_date}`)}
                </p>
                {filing.items.length > 0 && (
                  <p className="sec-filing__items">
                    {filing.items
                      .map((item) =>
                        item.description
                          ? `${item.code} ${item.description}`
                          : `Item ${item.code}`,
                      )
                      .join(" · ")}
                  </p>
                )}
              </div>
              <a
                className="sec-filing__link"
                href={filing.document_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open on SEC.gov
                <span className="visually-hidden">
                  {` (${filing.form} filed ${filing.filing_date}, opens in a new tab)`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {data.coverage_note && <p className="sec__note">{data.coverage_note}</p>}
    </Card>
  );
}

/** Shown when SEC lists no filer under a ticker: find the filer by name instead. */
function CompanyLookup({
  ticker,
  onChoose,
}: {
  ticker: string;
  onChoose: (q: string) => void;
}) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const results = useSecResource<SecSearchResponse>(submitted, (signal) =>
    searchSecCompanies(submitted as string, signal),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value) setSubmitted(value);
  };

  return (
    <div className="sec-lookup">
      <form className="sec-lookup__form" onSubmit={submit}>
        <label htmlFor="sec-lookup-input" className="sec-lookup__label">
          Find the company that files for {ticker} by name
        </label>
        <div className="sec-lookup__row">
          <input
            id="sec-lookup-input"
            className="sec-lookup__input"
            value={input}
            maxLength={80}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Company name"
          />
          <Button type="submit" small>
            Search SEC
          </Button>
        </div>
      </form>
      {results.error && <Callout tone="note">{results.error}</Callout>}
      {results.data &&
        (results.data.results.length === 0 ? (
          <p className="sec__empty">No SEC filer matches that name.</p>
        ) : (
          <ul className="sec-lookup__results" aria-label="Matching SEC filers">
            {results.data.results.map((company) => (
              <li key={company.cik}>
                <Button
                  variant="ghost"
                  small
                  onClick={() => onChoose(`CIK${company.cik}`)}
                >
                  {company.name ?? `CIK ${company.cik}`}
                  {company.tickers.length > 0 &&
                    ` (${company.tickers.join(", ")})`}
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
