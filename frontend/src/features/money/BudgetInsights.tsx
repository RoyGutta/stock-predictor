import { Button, Card } from "../../components/ui";
import type { PlanningUpdate } from "./BudgetsView";
import { formatCents, type MoneyState } from "./model";
import {
  AMOUNT_TOLERANCE,
  CADENCE_LABELS,
  candidateToRecurring,
  detectSubscriptionCandidates,
  MIN_OCCURRENCES,
  unusualCategoryChanges,
  UNUSUAL_MIN_CENTS,
  UNUSUAL_MIN_RATIO,
  type SubscriptionCandidate,
} from "./recurring";

const CONFIDENCE_TEXT: Record<SubscriptionCandidate["confidence"], string> = {
  high: "High: 4 or more identical payments at regular gaps",
  medium: "Medium: regular gaps, but 3 payments or varying amounts",
  low: "Low: mostly regular, with a gap outside the usual range",
};

/** Patterns found in the user's own records. Suggestions only; nothing is created unasked. */
export function BudgetInsights({
  state,
  onPlanning,
  today,
}: {
  state: MoneyState;
  onPlanning: PlanningUpdate;
  today: string;
}) {
  const planning = state.planning;
  const candidates = detectSubscriptionCandidates(
    state.transactions,
    planning.recurring,
  );
  const unusual = unusualCategoryChanges(state, today);
  const names = new Map(state.accounts.map((a) => [a.id, a.name]));
  const essential = new Set(planning.essential_categories);

  const track = (c: SubscriptionCandidate) =>
    onPlanning((p) => ({
      ...p,
      recurring: [...p.recurring, candidateToRecurring(c)],
    }));
  const toggleEssential = (category: string, on: boolean) =>
    onPlanning((p) => ({
      ...p,
      essential_categories: on
        ? [...p.essential_categories.filter((c) => c !== category), category]
        : p.essential_categories.filter((c) => c !== category),
    }));

  return (
    <>
      <Card title="Possible recurring payments">
        <p className="money-basis">
          Settled expenses with the same description on the same account, at
          least {MIN_OCCURRENCES} times, amounts within{" "}
          {Math.round(AMOUNT_TOLERANCE * 100)}% of each other, at a regular gap
          (weekly 6–8 days, every 2 weeks 13–15, monthly 28–31, quarterly 89–92,
          yearly 360–370; median gap). These are patterns in your records, not
          confirmed subscriptions. Nothing is added unless you choose to track
          it.
        </p>
        {candidates.length === 0 ? (
          <p className="money-basis">No regular patterns found.</p>
        ) : (
          <ul className="money-list">
            {candidates.map((c) => (
              <li key={c.key} className="money-item">
                <div className="money-item__head">
                  <div>
                    <p className="money-item__name">{c.description}</p>
                    <p className="money-sub">
                      {CADENCE_LABELS[c.cadence]} ·{" "}
                      {names.get(c.account_id) ?? "Unknown account"} ·{" "}
                      {c.category} · Confidence {CONFIDENCE_TEXT[c.confidence]}
                    </p>
                  </div>
                  <p className="money-item__amount">
                    {formatCents(c.typical_amount_cents)}
                    <span className="money-sub">median amount</span>
                  </p>
                </div>
                <p className="money-basis">{c.basis}</p>
                <details className="money-details">
                  <summary>Evidence ({c.evidence.length} payments)</summary>
                  <ul className="budgets-evidence">
                    {c.evidence.map((e, i) => (
                      <li key={`${e.date}-${i}`}>
                        {e.date}: {formatCents(e.amount_cents)}
                        {i > 0 && ` (${c.intervals_days[i - 1]} days later)`}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="money-actions">
                  <Button
                    small
                    aria-label={`Track ${c.description} as recurring`}
                    onClick={() => track(c)}
                  >
                    Track as recurring
                  </Button>
                  <span className="money-sub">
                    Adds {formatCents(c.typical_amount_cents)},{" "}
                    {CADENCE_LABELS[c.cadence].toLowerCase()}, next on{" "}
                    {c.suggested_next_date}. You can edit it after.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Unusual category changes">
        <p className="money-basis">
          Spending by category in {unusual.month} (the last complete month)
          against the average of up to 3 complete months before it. Flagged when
          at least {Math.round(UNUSUAL_MIN_RATIO * 100)}% and at least{" "}
          {formatCents(UNUSUAL_MIN_CENTS)} higher. Months before your earliest
          account start date, or with no recorded spending, are left out rather
          than counted as zero.
          {unusual.baseline_months.length > 0 &&
            ` Compared with: ${unusual.baseline_months.join(", ")}.`}
          {unusual.excluded_pre_tracking.length > 0 &&
            ` Left out, before tracking began: ${unusual.excluded_pre_tracking.join(", ")}.`}
          {unusual.excluded_no_spending.length > 0 &&
            ` Left out, no recorded spending: ${unusual.excluded_no_spending.join(", ")}.`}
        </p>
        {unusual.unavailable_reason ? (
          <p className="money-basis">
            Not compared: {unusual.unavailable_reason}
          </p>
        ) : unusual.changes.length === 0 ? (
          <p className="money-basis">No category met both thresholds.</p>
        ) : (
          <ul className="money-list">
            {unusual.changes.map((u) => (
              <li key={u.category} className="money-item">
                <div className="money-item__head">
                  <p className="money-item__name">▲ {u.category}</p>
                  <p className="money-item__amount">
                    +{formatCents(u.increase_cents)}
                    <span className="money-sub">
                      {u.increase_ratio === null
                        ? "no spending in the comparison months"
                        : `+${Math.round(u.increase_ratio * 100)}%`}
                    </span>
                  </p>
                </div>
                <p className="money-sub">
                  {unusual.month}: {formatCents(u.last_month_cents)}; average of{" "}
                  {unusual.baseline_months.length} earlier months:{" "}
                  {formatCents(u.baseline_average_cents)}.
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Essential categories">
        <fieldset className="budgets-essential">
          <legend className="money-basis">
            Spending you need to live. Used for the fixed vs variable split
            above, together with recurring items that have a fixed amount.
          </legend>
          {state.categories.map((c) => (
            <label key={c} className="money-check">
              <input
                type="checkbox"
                checked={essential.has(c)}
                onChange={(e) => toggleEssential(c, e.target.checked)}
              />
              {c}
            </label>
          ))}
        </fieldset>
      </Card>
    </>
  );
}
