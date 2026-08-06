import { Callout, Card } from "../../components/ui";
import type { Observation, TrendInterpretation } from "../../types/market";
import "./analysis.css";

function ObservationItem({ observation }: { observation: Observation }) {
  return (
    <li className={`observation observation--${observation.stance}`}>
      <div className="observation__head">
        <span className="observation__indicator">{observation.indicator}</span>
      </div>
      <p className="observation__headline">{observation.headline}</p>
      <p className="observation__detail">{observation.detail}</p>
      {/* Always shown. An indicator's failure mode is part of reading it. */}
      <p className="observation__caveat">{observation.caveat}</p>
    </li>
  );
}

function Column({
  heading,
  observations,
  emptyText,
}: {
  heading: string;
  observations: Observation[];
  emptyText: string;
}) {
  return (
    <div className="ledger__column">
      <div className="ledger__column-head">
        <h3 className="eyebrow">{heading}</h3>
        <span className="ledger__count">{observations.length}</span>
      </div>
      {observations.length === 0 ? (
        <p className="ledger__empty">{emptyText}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--space-4)" }}>
          {observations.map((observation) => (
            <ObservationItem key={observation.indicator} observation={observation} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Evidence for and against, side by side, with contradictions between them.
 *
 * Deliberately renders no verdict, no score out of ten, and no price target.
 * The agreement meter is labeled as agreement between indicators specifically
 * so it cannot be read as a probability.
 */
export function EvidenceLedger({ interpretation }: { interpretation: TrendInterpretation }) {
  const { bullish, bearish, neutral, conflicts, agreement_score, agreement_label } = interpretation;

  return (
    <Card
      title="What the indicators say"
      action={<span className="eyebrow">Historical analysis</span>}
    >
      <div className="ledger">
        <p className="ledger__summary">{interpretation.summary}</p>

        <div className="agreement">
          <span className="eyebrow">Indicator agreement</span>
          <div
            className="agreement__track"
            role="meter"
            aria-valuenow={Math.round(agreement_score * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="How much the indicators agree with each other"
          >
            <div className="agreement__fill" style={{ width: `${agreement_score * 100}%` }} />
          </div>
          <span className="agreement__label">{agreement_label}</span>
        </div>

        {conflicts.length > 0 && (
          <div className="conflicts">
            <h3 className="eyebrow">Where the evidence disagrees</h3>
            {conflicts.map((conflict) => (
              <p key={conflict} className="conflicts__item">
                {conflict}
              </p>
            ))}
          </div>
        )}

        <div className="ledger__columns">
          <Column
            heading="Points up"
            observations={bullish}
            emptyText="Nothing here points upward."
          />
          <div className="ledger__spine" aria-hidden="true" />
          <Column
            heading="Points down"
            observations={bearish}
            emptyText="Nothing here points downward."
          />
        </div>

        {neutral.length > 0 && (
          <>
            <hr className="rule" />
            <Column
              heading="No clear direction"
              observations={neutral}
              emptyText="Nothing neutral to report."
            />
          </>
        )}

        <Callout tone="accent">
          <p className="disclaimer">{interpretation.disclaimer}</p>
        </Callout>
      </div>
    </Card>
  );
}
