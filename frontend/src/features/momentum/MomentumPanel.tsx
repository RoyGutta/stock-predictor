import { Callout, Card } from "../../components/ui";
import { formatPrice } from "../../lib/format";
import type { Momentum, MomentumStateName } from "../../types/market";
import "./momentum.css";

/**
 * How each state is presented.
 *
 * `verdict` answers the question a reader actually arrives with — "is momentum
 * behind this right now?" — without answering the one the data cannot support,
 * which is whether buying it is a good idea. The distinction is the whole
 * design: favourable momentum is a description of the present, and an entry
 * decision is a claim about the future.
 */
const PRESENTATION: Record<
  MomentumStateName,
  { label: string; verdict: string; glyph: string; tone: string }
> = {
  bullish: {
    label: "Momentum is favourable",
    verdict: "All four conditions hold — this is what a short-term uptrend looks like.",
    glyph: "▲",
    tone: "bullish",
  },
  mixed: {
    label: "Momentum is mixed",
    verdict: "The averages are not cleanly stacked either way.",
    glyph: "◆",
    tone: "mixed",
  },
  bearish: {
    label: "Momentum is against it",
    verdict: "The averages are stacked the opposite way, with price below them.",
    glyph: "▼",
    tone: "bearish",
  },
  insufficient: {
    label: "Not enough history",
    verdict: "This range is too short to read the 100-day average.",
    glyph: "—",
    tone: "unknown",
  },
};

export function MomentumPanel({ momentum, ticker }: { momentum: Momentum; ticker: string }) {
  const presentation = PRESENTATION[momentum.state];
  const readable = momentum.state !== "insufficient";

  return (
    <Card
      title={`Short-term momentum — ${ticker}`}
      action={<span className="eyebrow">20 / 50 / 100-day averages</span>}
    >
      <div className={`mo-verdict mo-verdict--${presentation.tone}`}>
        <span className="mo-verdict__glyph" aria-hidden="true">
          {presentation.glyph}
        </span>
        <div className="mo-verdict__body">
          <p className="mo-verdict__label">{presentation.label}</p>
          <p className="mo-verdict__detail">{presentation.verdict}</p>
        </div>
        {readable && (
          <div className="mo-score">
            <span className="mo-score__value numeric">
              {momentum.score}
              <span className="mo-score__total">/{momentum.total}</span>
            </span>
            <span className="mo-score__label">conditions met</span>
          </div>
        )}
      </div>

      {readable && (
        <>
          <ul className="mo-conditions">
            {momentum.conditions.map((condition) => (
              <li
                key={condition.label}
                className={`mo-condition mo-condition--${condition.met ? "met" : "unmet"}`}
              >
                <span className="mo-condition__mark" aria-hidden="true">
                  {condition.met ? "✓" : "✕"}
                </span>
                <div>
                  <p className="mo-condition__label">
                    {condition.label}
                    {/* The glyph carries the state, but colour and shape alone
                        must never be the only signal. */}
                    <span className="visually-hidden">
                      {condition.met ? " — condition met" : " — condition not met"}
                    </span>
                  </p>
                  <p className="mo-condition__detail">{condition.detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <dl className="mo-levels">
            <div>
              <dt>Last close</dt>
              <dd className="numeric">{formatPrice(momentum.price)}</dd>
            </div>
            <div>
              <dt>20-day</dt>
              <dd className="numeric">{formatPrice(momentum.fast)}</dd>
            </div>
            <div>
              <dt>50-day</dt>
              <dd className="numeric">{formatPrice(momentum.medium)}</dd>
            </div>
            <div>
              <dt>100-day</dt>
              <dd className="numeric">{formatPrice(momentum.slow)}</dd>
            </div>
          </dl>
        </>
      )}

      <Callout tone="accent">
        <p className="mo-caveat">{momentum.caveat}</p>
      </Callout>
    </Card>
  );
}
