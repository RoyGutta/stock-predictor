/**
 * Finley topics answered from the ledger alone: position, cash, spending,
 * income, savings rate, debts, reserve, privacy, and help. Planning topics
 * (budgets, bills, goals, projections, holdings) live in planningTopics.ts.
 *
 * Every figure comes from ledger.ts, so Finley can never disagree with the
 * Overview. Wording describes; it does not advise.
 */

import { formatPercentPlain } from "../../lib/format";
import {
  completeMonths,
  debts,
  flows,
  monthBounds,
  position,
  ratios,
} from "../money/ledger";
import { formatCents } from "../money/model";
import type { Answer, Context, Figure, Topic } from "./engine";

const MONEY = { label: "Open Money Manager", href: "#/money" };

export function base(topic: string, title: string): Answer {
  return {
    topic,
    title,
    text: "",
    figures: [],
    basis: null,
    caveats: [],
    links: [MONEY],
    follow_ups: [],
  };
}

/** Every data topic needs at least one account; say so instead of showing zeros. */
export function needsAccounts(
  ctx: Context,
  topic: string,
  title: string,
): Answer | null {
  if (ctx.state.accounts.some((a) => !a.archived)) return null;
  return {
    ...base(topic, title),
    text:
      "There are no accounts in your Money Manager yet, so there is nothing to compute. " +
      "Add an account with its current balance to get started.",
  };
}

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function topCategories(
  byCategory: Record<string, number>,
  n: number,
): Figure[] {
  return Object.entries(byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([category, cents]) => ({
      label: category,
      value: formatCents(cents),
    }));
}

const netWorth: Topic = {
  id: "net_worth",
  example: "What is my net worth?",
  match: [
    ["net", "worth"],
    ["worth"],
    ["assets", "liabilities"],
    ["total", "assets"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "net_worth", "Net worth");
    if (empty) return empty;
    const p = position(ctx.state, ctx.today);
    const a = base("net_worth", "Net worth");
    a.text = `Your recorded assets minus recorded debts come to ${formatCents(p.net_worth)}.`;
    a.figures = [
      { label: "Assets", value: formatCents(p.total_assets) },
      { label: "Debts", value: formatCents(p.total_liabilities) },
      { label: "Net worth", value: formatCents(p.net_worth) },
    ];
    a.basis = `Settled balances as of ${ctx.today}, U.S. dollar accounts only.`;
    if (p.excluded_currency_accounts.length)
      a.caveats.push(
        `Not included (other currency): ${p.excluded_currency_accounts.join(", ")}.`,
      );
    if (p.pending_count)
      a.caveats.push(
        `${p.pending_count} pending transaction(s) are not counted yet.`,
      );
    a.caveats.push(
      "Values are only as current as the balances and valuations you entered.",
    );
    a.follow_ups = ["How much cash do I have?", "What do I owe?"];
    return a;
  },
};

const cash: Topic = {
  id: "cash",
  example: "How much cash do I have?",
  match: [
    ["cash"],
    ["liquid"],
    ["checking"],
    ["savings", "balance"],
    ["available", "money"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "cash", "Cash available");
    if (empty) return empty;
    const p = position(ctx.state, ctx.today);
    const a = base("cash", "Cash available");
    a.text = `Your cash, checking, savings, and money market accounts hold ${formatCents(p.liquid_assets)}.`;
    a.figures = [
      { label: "Liquid funds", value: formatCents(p.liquid_assets) },
    ];
    a.basis = `Settled balances as of ${ctx.today}. CDs and investments are not counted as liquid.`;
    if (p.pending_count)
      a.caveats.push(
        `${p.pending_count} pending transaction(s) may change this once they settle.`,
      );
    a.follow_ups = ["How many months of spending does my cash cover?"];
    return a;
  },
};

const lastMonth: Topic = {
  id: "spending_last_month",
  example: "How much did I spend last month?",
  match: [
    ["spend"],
    ["spent"],
    ["expenses"],
    ["spend", "last", "month"],
    ["categor"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(
      ctx,
      "spending_last_month",
      "Spending last month",
    );
    if (empty) return empty;
    const [m] = completeMonths(ctx.state, ctx.today, 1);
    const a = base("spending_last_month", `Spending in ${monthName(m.month)}`);
    if (m.income === 0 && m.spending === 0) {
      a.text = `There are no settled income or spending records for ${monthName(m.month)}, so Finley cannot say what you spent. That is different from spending nothing.`;
      return a;
    }
    a.text = `You recorded ${formatCents(m.spending)} of spending in ${monthName(m.month)}, against ${formatCents(m.income)} of income.`;
    a.figures = [
      { label: "Spending", value: formatCents(m.spending) },
      { label: "Income", value: formatCents(m.income) },
      ...topCategories(m.by_category, 3),
    ];
    a.basis = `Settled transactions dated ${m.start} to ${m.end}. Refunds reduce spending; transfers between your accounts are not spending, but interest paid on debt is.`;
    a.follow_ups = [
      "How much have I spent this month?",
      "What is my savings rate?",
    ];
    return a;
  },
};

const thisMonth: Topic = {
  id: "spending_this_month",
  example: "How much have I spent this month?",
  match: [
    ["spen", "this", "month"],
    ["spen", "month", "far"],
    ["month", "date"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(
      ctx,
      "spending_this_month",
      "Spending this month",
    );
    if (empty) return empty;
    const { start } = monthBounds(ctx.today.slice(0, 7));
    const f = flows(ctx.state, start, ctx.today);
    const a = base("spending_this_month", "Spending this month so far");
    a.text = `From ${start} to today you recorded ${formatCents(f.spending)} of spending and ${formatCents(f.income)} of income.`;
    a.figures = [
      { label: "Spending so far", value: formatCents(f.spending) },
      { label: "Income so far", value: formatCents(f.income) },
      ...topCategories(f.by_category, 3),
    ];
    a.basis = `Settled transactions dated ${start} to ${ctx.today}.`;
    a.caveats.push(
      "A partial month; comparing it with a full month overstates the difference.",
    );
    a.follow_ups = ["Am I within my budgets?"];
    return a;
  },
};

const savingsRate: Topic = {
  id: "savings_rate",
  example: "What is my savings rate?",
  match: [
    ["savings", "rate"],
    ["income"],
    ["earn"],
    ["surplus"],
    ["save", "month"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "savings_rate", "Savings rate");
    if (empty) return empty;
    const r = ratios(ctx.state, ctx.today);
    const a = base("savings_rate", "Income, spending, and savings rate");
    if (r.months_used === 0 || r.average_monthly_income == null) {
      a.text =
        "There are no complete months with income or spending records yet, so these cannot be computed.";
      a.basis = "Needs at least one complete calendar month of records.";
      return a;
    }
    const income = r.average_monthly_income;
    const spending = r.average_monthly_spending ?? 0;
    const rate = income > 0 ? (income - spending) / income : null;
    a.text =
      rate == null
        ? "No income was recorded in these months, so a savings rate cannot be computed."
        : `On average you kept ${formatPercentPlain(rate)} of your income.`;
    a.figures = [
      {
        label: "Average monthly income",
        value: formatCents(Math.round(income)),
      },
      {
        label: "Average monthly spending",
        value: formatCents(Math.round(spending)),
      },
      {
        label: "Savings rate",
        value: formatPercentPlain(rate),
        note:
          rate == null ? "No income recorded." : "(income − spending) ÷ income",
      },
    ];
    a.basis = `Average of the last ${r.months_used} complete month(s) that have records; months with no records are left out rather than counted as zero.`;
    a.follow_ups = ["How much did I spend last month?"];
    return a;
  },
};

const debtSummary: Topic = {
  id: "debts",
  example: "What do I owe?",
  match: [
    ["debt"],
    ["owe"],
    ["loan"],
    ["credit", "card"],
    ["pay", "off"],
    ["payoff"],
    ["interest"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "debts", "Debts");
    if (empty) return empty;
    const rows = debts(ctx.state, ctx.today).filter((d) => d.balance_cents > 0);
    const a = base("debts", "Debts");
    if (rows.length === 0) {
      a.text = "You have no debt accounts with a balance owed.";
      return a;
    }
    const total = rows.reduce((s, d) => s + d.balance_cents, 0);
    a.text = `You owe ${formatCents(total)} across ${rows.length} account(s).`;
    a.figures = rows.map((d) => ({
      label: d.account.name,
      value: formatCents(d.balance_cents),
      note: d.missing.length
        ? `Missing ${d.missing.join(" and ")}, so a payoff time cannot be computed.`
        : d.payoff.feasible
          ? `${d.account.apr}% APR; about ${d.payoff.months} months at the ${d.payment_basis} payment of ${formatCents(d.payment_cents)}.`
          : `${d.account.apr}% APR; ${d.payoff.reason ?? "not paid off at the recorded payment."}`,
    }));
    a.basis = `Settled balances as of ${ctx.today}; payoff uses monthly interest = balance × APR ÷ 12 and the payment you recorded.`;
    a.caveats.push(
      "Card issuers compound daily and may apply payments differently, so real payoff dates can differ.",
    );
    return a;
  },
};

const reserve: Topic = {
  id: "reserve",
  example: "How many months of spending does my cash cover?",
  match: [
    ["emergency"],
    ["months", "cover"],
    ["reserve"],
    ["runway"],
    ["rainy", "day"],
    ["lose", "job"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "reserve", "Cash reserve");
    if (empty) return empty;
    const r = ratios(ctx.state, ctx.today);
    const p = position(ctx.state, ctx.today);
    const target = ctx.state.planning.profile.emergency_months_target;
    const a = base("reserve", "Cash reserve");
    const covered = r.months_of_spending_covered;
    if (covered == null) {
      a.text =
        "There is no spending in recent complete months to compare your cash with, so coverage cannot be computed.";
      a.figures = [
        { label: "Liquid funds", value: formatCents(p.liquid_assets) },
      ];
      return a;
    }
    a.text = `Your liquid funds would cover about ${covered.toFixed(1)} months of your average spending.`;
    a.figures = [
      { label: "Liquid funds", value: formatCents(p.liquid_assets) },
      {
        label: "Average monthly spending",
        value: formatCents(Math.round(r.average_monthly_spending ?? 0)),
      },
      { label: "Months covered", value: covered.toFixed(1) },
      {
        label: "Your target",
        value: target == null ? "—" : `${target} months`,
        note:
          target == null
            ? "Not set. You can set one in your planning profile."
            : undefined,
      },
    ];
    a.basis = `Liquid balances as of ${ctx.today} ÷ average spending over the last ${r.months_used} complete month(s) with records.`;
    a.caveats.push(
      "This uses all spending, not only essentials, so it is a conservative measure.",
    );
    return a;
  },
};

const privacy: Topic = {
  id: "privacy",
  example: "Where is my data stored?",
  match: [
    ["privacy"],
    ["private"],
    ["data", "stored"],
    ["where", "data"],
    ["who", "see"],
    ["secure"],
    ["delete", "data"],
  ],
  answer: () => ({
    ...base("privacy", "Where your data lives"),
    text:
      "Everything you enter in Money Manager is stored only in this browser's local storage on this device. " +
      "It is not sent to this app's server or to any AI service, and Finley reads it here, in your browser. " +
      "Clearing site data, or Delete all on the Data tab, removes it; an encrypted backup file is the only copy you can move.",
    basis:
      "How the app is built: the Money Manager code makes no network requests.",
  }),
};

const about: Topic = {
  id: "about",
  example: "Who is Finley?",
  match: [["help"], ["finley"], ["ai"], ["chatgpt"], ["claude"], ["questions"]],
  answer: () => ({
    ...base("about", "About Finley"),
    text:
      "Finley is a rule-based helper, not an AI model. It recognizes a fixed set of questions and answers them " +
      "by calculating from the records in your Money Manager, in this browser. It describes your numbers; it " +
      "does not recommend investments, predict markets, or give tax or legal guidance.",
  }),
};

/** Order matters for ties: more specific topics first. */
export const CORE_TOPICS: Topic[] = [
  thisMonth,
  lastMonth,
  netWorth,
  cash,
  savingsRate,
  debtSummary,
  reserve,
  privacy,
  about,
];
