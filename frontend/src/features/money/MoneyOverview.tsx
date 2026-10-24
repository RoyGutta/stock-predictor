import { Callout, Card, Stat } from "../../components/ui";
import { formatPercentPlain } from "../../lib/format";
import {
  completeMonths,
  debts,
  flows,
  monthBounds,
  position,
  ratios,
} from "./ledger";
import { ACCOUNT_TYPES, formatCents, todayIso, type MoneyState } from "./model";

function months(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)} months`;
}

/**
 * The user's financial position, computed only from what they entered. Every
 * figure names its basis; anything that cannot be computed says why.
 */
export function MoneyOverview({
  state,
  onStart,
}: {
  state: MoneyState;
  onStart: () => void;
}) {
  const today = todayIso();
  if (state.accounts.length === 0) {
    return (
      <Card title="Get started">
        <ol className="money-steps">
          <li>
            <strong>Add your accounts</strong> with today&rsquo;s balance:
            checking, savings, cards, loans, investments. No history is needed;
            the opening balance is the starting point.
          </li>
          <li>
            <strong>Record transactions</strong> as they happen, or import a CSV
            export from your bank. Moving money between your own accounts is a
            transfer, never income or spending.
          </li>
          <li>
            <strong>Make an encrypted backup</strong> from the Data tab. Your
            records exist only in this browser.
          </li>
        </ol>
        <button
          type="button"
          className="button button--primary"
          onClick={onStart}
        >
          Add your first account
        </button>
      </Card>
    );
  }

  const pos = position(state, today);
  const r = ratios(state, today);
  // Months before the earliest account's start date were not being tracked:
  // showing them as $0.00 would report missing records as zero activity.
  const trackingSince = state.accounts.reduce(
    (min, a) => (a.opening_date < min ? a.opening_date : min),
    "9999-12-31",
  );
  const allRecent = completeMonths(state, today, 6);
  const recent = allRecent.filter((m) => m.end >= trackingSince);
  const omitted = allRecent.length - recent.length;
  const last = allRecent[allRecent.length - 1];
  const lastTracked = recent.length > 0;
  const thisMonth = monthBounds(today.slice(0, 7));
  const monthToDate = flows(state, thisMonth.start, today);
  const debtRows = debts(state, today);
  const categories = Object.entries(last.by_category)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <>
      {pos.excluded_currency_accounts.length > 0 && (
        <Callout tone="note">
          Not in these totals (not U.S. dollars):{" "}
          {pos.excluded_currency_accounts.join(", ")}. Currencies are not
          converted.
        </Callout>
      )}
      <Card
        title="Where you stand"
        action={<span className="eyebrow">As of {today}</span>}
      >
        <div className="money-stats">
          <Stat
            label="Net worth"
            value={formatCents(pos.net_worth)}
            note="Assets minus debts"
          />
          <Stat label="Assets" value={formatCents(pos.total_assets)} />
          <Stat label="Debts" value={formatCents(pos.total_liabilities)} />
          <Stat
            label="Liquid funds"
            value={formatCents(pos.liquid_assets)}
            note="Cash, checking, savings, money market"
          />
        </div>
        <p className="money-basis">
          Balances are opening balances plus settled transactions up to today.
          {pos.pending_count > 0 &&
            ` ${pos.pending_count} pending transaction${pos.pending_count === 1 ? " is" : "s are"} not included until settled.`}{" "}
          Values for investments, property, and vehicles are what you entered,
          as of the date you entered them; nothing here looks up market prices.
        </p>
      </Card>

      <Card title="Income and spending">
        <div className="money-stats">
          <Stat
            label={`Income, ${last.month}`}
            value={formatCents(last.income)}
            note="Last complete month"
          />
          <Stat
            label={`Spending, ${last.month}`}
            value={formatCents(last.spending)}
          />
          <Stat
            label="Savings rate"
            value={
              last.savings_rate == null
                ? "—"
                : formatPercentPlain(last.savings_rate)
            }
            note={
              last.savings_rate == null
                ? "Needs recorded income"
                : "(Income − spending) ÷ income"
            }
          />
          <Stat
            label="This month so far"
            value={formatCents(monthToDate.spending)}
            note={`Spending since ${thisMonth.start}`}
          />
        </div>
        {lastTracked ? (
          <div className="money-table-scroll">
            <table className="money-table">
              <caption>
                Complete months since tracking began (up to six)
              </caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Income</th>
                  <th scope="col">Spending</th>
                  <th scope="col">Net</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{m.month}</th>
                    <td>{formatCents(m.income)}</td>
                    <td>{formatCents(m.spending)}</td>
                    <td className={m.net < 0 ? "money-negative" : undefined}>
                      {m.net < 0 && (
                        <span className="visually-hidden">Shortfall: </span>
                      )}
                      {formatCents(m.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="money-basis">
            No complete month has passed since your earliest account&rsquo;s
            start date ({trackingSince}), so there is no monthly history yet.
          </p>
        )}
        {omitted > 0 && lastTracked && (
          <p className="money-basis">
            Months before {trackingSince} are not shown: nothing was being
            tracked then, and showing them as $0.00 would misstate them.
          </p>
        )}
        <p className="money-basis">
          Transfers between your accounts and changes in investment or property
          values are neither income nor spending. Interest paid on debts counts
          as spending.
        </p>
        {categories.length > 0 && (
          <div className="money-table-scroll">
            <table className="money-table">
              <caption>Spending by category, {last.month}</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(([name, cents]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{formatCents(cents)}</td>
                    <td>
                      {last.spending > 0
                        ? formatPercentPlain(cents / last.spending)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Cushion and debt load">
        <div className="money-stats">
          <Stat
            label="Spending covered by liquid funds"
            value={months(r.months_of_spending_covered)}
            note={
              r.months_used === 0
                ? "Needs a complete month of records"
                : `Average spending over ${r.months_used} complete month${r.months_used === 1 ? "" : "s"}`
            }
          />
          <Stat
            label="Debts ÷ assets"
            value={
              r.debt_to_assets == null
                ? "—"
                : formatPercentPlain(r.debt_to_assets)
            }
            note={
              r.debt_to_assets == null
                ? "Needs at least one asset"
                : "Total debts over total assets"
            }
          />
          <Stat
            label="Minimum payments ÷ income"
            value={
              r.debt_payment_to_income == null
                ? "—"
                : formatPercentPlain(r.debt_payment_to_income)
            }
            note={
              r.debt_payment_to_income == null
                ? "Needs recorded income and minimum payments"
                : `Average monthly income${r.debts_missing_minimum ? `; ${r.debts_missing_minimum} debt(s) have no minimum recorded and are left out` : ""}`
            }
          />
        </div>
      </Card>

      {debtRows.length > 0 && (
        <Card title="Debts">
          <div className="money-table-scroll">
            <table className="money-table">
              <caption className="visually-hidden">
                Each debt with its estimated payoff
              </caption>
              <thead>
                <tr>
                  <th scope="col">Debt</th>
                  <th scope="col">Owed</th>
                  <th scope="col">APR</th>
                  <th scope="col">Interest / month</th>
                  <th scope="col">Payoff</th>
                </tr>
              </thead>
              <tbody>
                {debtRows.map((d) => (
                  <tr key={d.account.id}>
                    <th scope="row">
                      {d.account.name}
                      <span className="money-sub">
                        {ACCOUNT_TYPES[d.account.type].label}
                      </span>
                    </th>
                    <td>{formatCents(d.balance_cents)}</td>
                    <td>
                      {d.account.apr == null
                        ? "Not recorded"
                        : `${d.account.apr}%`}
                    </td>
                    <td>{formatCents(d.monthly_interest_cents)}</td>
                    <td>
                      {d.payoff.feasible
                        ? `${d.payoff.months} months at ${formatCents(d.payment_cents)} (${d.payment_basis}); ${formatCents(d.payoff.total_interest_cents)} interest`
                        : d.payoff.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="money-basis">
            Payoff estimates assume the balance accrues APR ÷ 12 each month and
            the stated payment is made every month with no new charges. Cards
            compound daily and lenders apply payments on their own dates, so
            real figures will differ somewhat. A missing rate or payment is
            never assumed to be zero.
          </p>
        </Card>
      )}
    </>
  );
}
