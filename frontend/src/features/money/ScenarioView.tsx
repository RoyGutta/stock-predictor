import { useState } from "react";

import { Callout, Card } from "../../components/ui";
import { formatPercentPlain } from "../../lib/format";
import { isLiquid } from "./planInputs";
import {
  ACCOUNT_TYPES,
  formatCents,
  parseMoney,
  todayIso,
  type MoneyState,
} from "./model";
import {
  runScenario,
  type MonthlyChange,
  type PurchaseInput,
  type ScenarioRow,
} from "./scenario";
import "./planTools.css";

function show(row: ScenarioRow, value: number | null): string {
  if (value == null) return "—";
  if (row.unit === "cents") return formatCents(value);
  if (row.unit === "ratio") return formatPercentPlain(value);
  return `${value.toFixed(1)} months`;
}

function signedChange(
  text: string,
  date: string,
  label: string,
  errors: string[],
): MonthlyChange | null {
  if (text.trim() === "") return null;
  const cents = parseMoney(text, { allowNegative: true });
  if (cents == null) {
    errors.push(`Enter the ${label} as a plain number, like 150 or -150.`);
    return null;
  }
  return { monthly_cents: cents, start_date: date };
}

/**
 * Current position next to the position with a proposed purchase or change.
 * Every figure is labelled as entered by the user or calculated from records;
 * the text describes, it does not advise or guarantee.
 */
export function ScenarioView({ state }: { state: MoneyState }) {
  const today = todayIso();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [financed, setFinanced] = useState(false);
  const [loanAmount, setLoanAmount] = useState("");
  const [apr, setApr] = useState("");
  const [term, setTerm] = useState("");
  const [spend, setSpend] = useState("");
  const [spendDate, setSpendDate] = useState(today);
  const [income, setIncome] = useState("");
  const [incomeDate, setIncomeDate] = useState(today);

  const errors: string[] = [];
  let purchase: PurchaseInput | null = null;
  if (amount.trim() !== "") {
    const price = parseMoney(amount);
    if (price == null) errors.push("Enter the price as a plain number.");
    let financing: PurchaseInput["financing"] = null;
    if (financed) {
      const principal = parseMoney(loanAmount);
      const rate = apr.trim() === "" ? NaN : Number(apr);
      const months = term.trim() === "" ? NaN : Number(term);
      if (principal == null) errors.push("Enter the amount financed.");
      if (!Number.isFinite(rate)) errors.push("Enter the loan's APR.");
      if (!Number.isFinite(months))
        errors.push("Enter the loan term in months.");
      if (principal != null && Number.isFinite(rate) && Number.isFinite(months))
        financing = {
          financed_cents: principal,
          apr: rate,
          term_months: months,
        };
    }
    if (price != null && (!financed || financing))
      purchase = {
        amount_cents: price,
        date,
        account_id: accountId || null,
        financing,
      };
  }
  const recurring_change = signedChange(
    spend,
    spendDate,
    "change in monthly spending",
    errors,
  );
  const income_change = signedChange(
    income,
    incomeDate,
    "change in monthly income",
    errors,
  );
  const result = runScenario(state, today, {
    purchase,
    recurring_change,
    income_change,
  });
  const problems = [...errors, ...result.problems];
  const entered = purchase || recurring_change || income_change;
  const accounts = state.accounts.filter(
    (a) => !a.archived && a.currency === "USD",
  );
  const paidFrom = accounts.find((a) => a.id === accountId);

  return (
    <>
      <Card title="Try a purchase or a change">
        <form onSubmit={(e) => e.preventDefault()}>
          <fieldset className="plan-fieldset">
            <legend>One-time purchase</legend>
            <div className="money-form">
              <label>
                Price
                <input
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Paid from
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Liquid funds (any account)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({ACCOUNT_TYPES[a.type].label})
                    </option>
                  ))}
                </select>
              </label>
              <label className="money-check">
                <input
                  type="checkbox"
                  checked={financed}
                  onChange={(e) => setFinanced(e.target.checked)}
                />
                Financed with a loan
              </label>
              {financed && (
                <>
                  <label>
                    Amount financed
                    <input
                      value={loanAmount}
                      inputMode="decimal"
                      onChange={(e) => setLoanAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    Loan APR (%)
                    <input
                      value={apr}
                      inputMode="decimal"
                      onChange={(e) => setApr(e.target.value)}
                    />
                  </label>
                  <label>
                    Term (months)
                    <input
                      value={term}
                      inputMode="numeric"
                      onChange={(e) => setTerm(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            {paidFrom && !isLiquid(paidFrom) && (
              <p className="money-basis">
                {paidFrom.name} is not counted as liquid funds, so paying from
                it does not lower the liquid figures below.
              </p>
            )}
          </fieldset>
          <fieldset className="plan-fieldset">
            <legend>Recurring change</legend>
            <div className="money-form">
              <label>
                Change in monthly spending (negative for less)
                <input
                  value={spend}
                  inputMode="decimal"
                  onChange={(e) => setSpend(e.target.value)}
                />
              </label>
              <label>
                Starting
                <input
                  type="date"
                  value={spendDate}
                  onChange={(e) => setSpendDate(e.target.value)}
                />
              </label>
              <label>
                Change in monthly income (negative for less)
                <input
                  value={income}
                  inputMode="decimal"
                  onChange={(e) => setIncome(e.target.value)}
                />
              </label>
              <label>
                Income change starting
                <input
                  type="date"
                  value={incomeDate}
                  onChange={(e) => setIncomeDate(e.target.value)}
                />
              </label>
            </div>
          </fieldset>
        </form>
        {problems.length > 0 && (
          <Callout tone="error" role="alert">
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Callout>
        )}
      </Card>

      <Card title="Current and proposed">
        {entered && problems.length === 0 && (
          <p className="plan-verdict" role="status">
            {result.verdict}
          </p>
        )}
        <div className="money-table-scroll">
          <table className="money-table plan-table">
            <caption className="visually-hidden">
              Each measure now and with the proposed change
            </caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Current</th>
                <th scope="col">Proposed</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.label}
                    <span className="money-sub">{row.basis}</span>
                  </th>
                  <td>{show(row, row.current)}</td>
                  <td>{show(row, row.proposed)}</td>
                  <td className="plan-source">
                    {row.source === "user-entered"
                      ? "You entered"
                      : "Calculated"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.goals.length > 0 && (
          <ul className="money-basis">
            {result.goals.map((g) => (
              <li key={g.id}>
                {g.name}: {formatCents(g.remaining_cents)} remaining over{" "}
                {g.months_left} month{g.months_left === 1 ? "" : "s"} is about{" "}
                {formatCents(g.required_monthly_cents)} a month.
                {g.note ? ` ${g.note}` : ""}
              </li>
            ))}
          </ul>
        )}
        {result.goals_without_date.length > 0 && (
          <p className="money-basis">
            Goals with no target date are not in the monthly figure:{" "}
            {result.goals_without_date.join(", ")}.
          </p>
        )}
        <Callout tone="note">
          This compares figures under stated assumptions; it does not guarantee
          that future bills, loan payments, or goals can be met. Averages come
          from complete months since tracking began ({result.months_used} used),
          and the 90-day projection counts only recurring items you have set up,
          so irregular spending and income changes you have not entered are not
          reflected.
        </Callout>
      </Card>
    </>
  );
}
