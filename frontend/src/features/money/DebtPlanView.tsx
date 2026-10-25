import { useMemo, useState } from "react";

import { Button, Callout, Card, Stat } from "../../components/ui";
import {
  avalancheOrder,
  compareResults,
  debtsFromState,
  liquidityCheck,
  liquidityInputs,
  planDebts,
  STRATEGY_LABELS,
  type Comparison,
  type PlanDebt,
  type Strategy,
  type StrategyResult,
} from "./debtPlan";
import { formatCents, parseMoney, todayIso, type MoneyState } from "./model";
import "./planTools.css";

const STRATEGIES: Strategy[] = ["avalanche", "snowball", "custom"];

function centsText(cents: number): string {
  return (cents / 100).toFixed(2);
}

function monthsText(n: number | null): string {
  return n == null ? "—" : `${n} month${n === 1 ? "" : "s"}`;
}

/** Apply a lump sum to debts in `order`, each up to its balance. */
function afterLumpSum(
  debts: PlanDebt[],
  order: string[],
  lumpCents: number,
): PlanDebt[] {
  let left = lumpCents;
  const paid = new Map<string, number>();
  for (const id of order) {
    const d = debts.find((x) => x.id === id);
    if (!d || left <= 0) continue;
    const pay = Math.min(left, d.balance_cents);
    paid.set(id, pay);
    left -= pay;
  }
  return debts.map((d) => ({
    ...d,
    balance_cents: d.balance_cents - (paid.get(d.id) ?? 0),
  }));
}

/**
 * Debt payoff strategies computed from the user's recorded debts, with a
 * lump-sum check against their emergency reserve. Descriptive only: it shows
 * what each order of payment would do under stated assumptions.
 */
export function DebtPlanView({ state }: { state: MoneyState }) {
  const today = todayIso();
  const source = useMemo(() => debtsFromState(state, today), [state, today]);
  const [budgetText, setBudgetText] = useState(() =>
    centsText(source.default_budget_cents),
  );
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const [lumpText, setLumpText] = useState("");
  const [lumpStrategy, setLumpStrategy] = useState<Strategy>("avalanche");

  const budget = parseMoney(budgetText);
  const plan = planDebts(source.debts, budget ?? 0, userOrder);
  const order = plan.results.custom.order;

  if (source.debts.length === 0) {
    return (
      <Card title="Debt payoff plan">
        <p className="money-basis">
          No open debts are recorded. Add a credit card or loan account with its
          balance, APR, and minimum payment to compare payoff orders.
        </p>
      </Card>
    );
  }

  const move = (index: number, delta: -1 | 1) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setUserOrder(next);
  };
  const names = new Map(source.debts.map((d) => [d.id, d.name]));

  const liquidity = liquidityInputs(state, today);
  const lump = lumpText.trim() === "" ? null : parseMoney(lumpText);
  const check = liquidityCheck(liquidity, lump);
  const lumpResult = (() => {
    if (budget == null || check.usable_cents == null || check.usable_cents <= 0)
      return null;
    const chosen = plan.results[lumpStrategy];
    const reduced = afterLumpSum(
      plan.included,
      chosen.order,
      check.usable_cents,
    );
    const next = planDebts(reduced, budget, userOrder).results[lumpStrategy];
    return { before: chosen, after: next, diff: compareResults(next, chosen) };
  })();

  return (
    <>
      <Card title="Debt payoff plan">
        <div className="money-inline">
          <label>
            Total paid toward debts each month
            <input
              value={budgetText}
              inputMode="decimal"
              aria-describedby="plan-budget-basis"
              onChange={(e) => setBudgetText(e.target.value)}
            />
          </label>
        </div>
        <p className="money-basis" id="plan-budget-basis">
          Starts at {formatCents(source.default_budget_cents)}: each
          debt&rsquo;s planned payment, or its minimum where no plan is
          recorded. The sum of minimum payments for the debts below is{" "}
          {formatCents(plan.sum_minimums_cents)}.
        </p>
        {budget == null && (
          <Callout tone="error" role="alert">
            Enter the monthly amount as a plain number, like 450 or 450.00.
          </Callout>
        )}
        {plan.missing.length > 0 && (
          <Callout tone="note">
            <strong>Missing inputs that change the result.</strong> These debts
            are left out of every plan below until the missing value is added on
            the Accounts tab; nothing is assumed to be zero.
            <ul>
              {plan.missing.map((m) => (
                <li key={m.id}>
                  {m.name}: no {m.missing.join(" or ")} recorded
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {budget != null && plan.included.length > 0 && (
          <StrategyTable results={plan.results} />
        )}
      </Card>

      {budget != null && plan.included.length > 0 && (
        <Card title="When each debt is paid off">
          <div className="money-table-scroll">
            <table className="money-table plan-table">
              <caption className="visually-hidden">
                Payoff month for each debt under each strategy
              </caption>
              <thead>
                <tr>
                  <th scope="col">Debt</th>
                  <th scope="col">Owed</th>
                  <th scope="col">APR</th>
                  <th scope="col">Minimum</th>
                  <th scope="col">Avalanche</th>
                  <th scope="col">Snowball</th>
                  <th scope="col">Your order</th>
                </tr>
              </thead>
              <tbody>
                {plan.included.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{d.name}</th>
                    <td>{formatCents(d.balance_cents)}</td>
                    <td>{d.apr}%</td>
                    <td>{formatCents(d.minimum_cents)}</td>
                    {STRATEGIES.map((s) => (
                      <td key={s}>
                        {plan.results[s].feasible
                          ? `Month ${plan.results[s].payoff_month[d.id]}`
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="money-subtitle">Your order</h3>
          <p className="money-basis">
            Extra money goes to the first debt in this list until it is paid,
            then the next. It starts in highest-rate order.
          </p>
          <ol className="plan-order" aria-label="Your payoff order">
            {order.map((id, i) => (
              <li key={id} className="plan-order__item">
                <span className="plan-order__name">
                  {i + 1}. {names.get(id)}
                </span>
                <span className="plan-order__buttons">
                  <Button
                    small
                    variant="ghost"
                    disabled={i === 0}
                    aria-label={`Move ${names.get(id)} up`}
                    onClick={() => move(i, -1)}
                  >
                    ↑ Up
                  </Button>
                  <Button
                    small
                    variant="ghost"
                    disabled={i === order.length - 1}
                    aria-label={`Move ${names.get(id)} down`}
                    onClick={() => move(i, 1)}
                  >
                    ↓ Down
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          {userOrder.length > 0 && (
            <p className="money-basis">
              <Button
                small
                variant="ghost"
                onClick={() => setUserOrder(avalancheOrder(plan.included))}
              >
                Reset to highest-rate order
              </Button>
            </p>
          )}
        </Card>
      )}

      <Card title="A one-time extra payment">
        <div className="money-inline">
          <label>
            Lump sum to consider
            <input
              value={lumpText}
              inputMode="decimal"
              onChange={(e) => setLumpText(e.target.value)}
            />
          </label>
          <label>
            Applied in this order
            <select
              value={lumpStrategy}
              onChange={(e) => setLumpStrategy(e.target.value as Strategy)}
            >
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {STRATEGY_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {lump === null && lumpText.trim() !== "" && (
          <Callout tone="error" role="alert">
            Enter the lump sum as a plain number, like 2000.
          </Callout>
        )}
        {check.reason ? (
          <Callout tone="note">{check.reason}</Callout>
        ) : (
          <div className="money-stats">
            <Stat
              label="Liquid funds"
              value={formatCents(liquidity.liquid_cents)}
              note="Cash, checking, savings, money market"
            />
            <Stat
              label="Reserve kept back"
              value={formatCents(check.reserve_cents)}
              note={`${liquidity.emergency_months_target} months (your target) × ${formatCents(liquidity.essential_monthly_cents)} essential spending a month`}
            />
            <Stat
              label="Recurring payments, next 30 days"
              value={formatCents(liquidity.obligations_30d_cents)}
              note="From your recurring items"
            />
            <Stat
              label="Could go to debt"
              value={formatCents(check.available_cents)}
              note="Liquid funds minus the reserve and the next 30 days"
            />
          </div>
        )}
        {lumpResult && (
          <p className="money-basis" role="status">
            Paying {formatCents(check.usable_cents)}
            {lump != null && check.usable_cents! < lump
              ? ` (the part of ${formatCents(lump)} above the reserve is left out)`
              : ""}{" "}
            now, in {STRATEGY_LABELS[lumpStrategy].toLowerCase()} order, would
            change debt-free from {monthsText(lumpResult.before.months)} to{" "}
            {monthsText(lumpResult.after.months)} and total interest from{" "}
            {formatCents(lumpResult.before.total_interest_cents)} to{" "}
            {formatCents(lumpResult.after.total_interest_cents)}.
          </p>
        )}
        <p className="money-basis">
          The reserve is your emergency target in months times average spending
          in your essential categories over the last{" "}
          {liquidity.months_used || "few"} complete month
          {liquidity.months_used === 1 ? "" : "s"} since tracking began. The
          amount shown never includes the reserve or money already committed to
          recurring payments in the next 30 days; income is not counted in
          advance.
        </p>
      </Card>

      <Card title="Assumptions">
        <p className="money-basis">
          Each month every debt accrues APR ÷ 12 on its balance (rounded to the
          cent), every minimum is paid, and the rest of the monthly amount goes
          to debts in the strategy&rsquo;s order. When a debt is paid off its
          minimum moves to the next one, so the monthly amount stays the same.
          Orders are set from today&rsquo;s balances. No new charges are
          assumed. Cards compound daily and lenders apply payments on their own
          dates, so real figures will differ somewhat. These are illustrations
          of each order under these assumptions, not a recommendation.
          {source.paid_off.length > 0 &&
            ` Already at zero and not shown: ${source.paid_off.join(", ")}.`}
        </p>
      </Card>
    </>
  );
}

function diffText(diff: Comparison): string {
  const m = diff.months_difference;
  const i = diff.interest_difference_cents;
  if (m == null || i == null) return "—";
  if (m === 0 && i === 0) return "Same";
  const months =
    m === 0
      ? "same time"
      : `${monthsText(Math.abs(m))} ${m > 0 ? "later" : "sooner"}`;
  const interest =
    i === 0
      ? "same interest"
      : `${formatCents(Math.abs(i))} ${i > 0 ? "more" : "less"} interest`;
  return `${months}; ${interest}`;
}

function StrategyTable({
  results,
}: {
  results: Record<Strategy, StrategyResult>;
}) {
  const base = results.avalanche;
  return (
    <div className="money-table-scroll">
      <table className="money-table plan-table">
        <caption>Strategies compared</caption>
        <thead>
          <tr>
            <th scope="col">Strategy</th>
            <th scope="col">Debt-free in</th>
            <th scope="col">Total interest</th>
            <th scope="col">Compared with avalanche</th>
          </tr>
        </thead>
        <tbody>
          {STRATEGIES.map((s) => {
            const r = results[s];
            const diff = compareResults(base, r);
            return (
              <tr key={s}>
                <th scope="row">{STRATEGY_LABELS[s]}</th>
                {r.feasible ? (
                  <>
                    <td>{monthsText(r.months)}</td>
                    <td>{formatCents(r.total_interest_cents)}</td>
                    <td>{s === "avalanche" ? "—" : diffText(diff)}</td>
                  </>
                ) : (
                  <td colSpan={3}>Not computed: {r.reason}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
