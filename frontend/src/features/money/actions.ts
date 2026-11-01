/**
 * Action list: transparent rules over the user's own records. Each action names
 * the rule and threshold that produced it, the figures behind it, what acting
 * would change where that can be computed, and the trade-offs. Nothing here
 * recommends a security: concentration is described, never traded.
 *
 * Every rule reuses the module behind a Money tab, so an action and the tab it
 * links to always show the same numbers.
 */

import { budgetReport } from "./budgets";
import {
  debtsFromState,
  liquidityCheck,
  liquidityInputs,
  partitionDebts,
} from "./debtPlan";
import { projectCashFlow } from "./forecast";
import { feasibility, monthlyEquivalent } from "./goals";
import {
  concentration,
  portfolio,
  SECTOR_LIMIT_PCT,
  SINGLE_HOLDING_LIMIT_PCT,
  STALE_PRICE_DAYS,
} from "./holdings";
import { formatCents, type MoneyState } from "./model";
import type { ActionDecision } from "./planning";
import { detectSubscriptionCandidates } from "./recurring";

/** Debts at or above this APR (percent) are listed. This app's line, stated in each action. */
export const HIGH_INTEREST_APR = 10;
export const DEFER_DAYS = 30;

export type ActionKind =
  | "shortfall"
  | "reserve"
  | "high_interest"
  | "budget"
  | "goal"
  | "concentration"
  | "subscriptions"
  | "missing_input";

export type ActionPriority = 1 | 2 | 3;

export const PRIORITY_LABELS: Record<ActionPriority, string> = {
  1: "Time-sensitive",
  2: "Worth a look",
  3: "Missing information or for review",
};

export interface ActionItem {
  /** Stable across days, so a decision on it sticks. */
  id: string;
  kind: ActionKind;
  priority: ActionPriority;
  title: string;
  /** The rule, in words, with its threshold. */
  reason: string;
  figures: { label: string; value: string; note?: string }[];
  /** A computed effect of acting, only where the arithmetic supports one. */
  impact: string | null;
  tradeoffs: string[];
  link: { label: string; href: string };
}

/** The rules, in the order they are checked; shown to the user as-is. */
export const RULES: { kind: ActionKind; text: string }[] = [
  {
    kind: "shortfall",
    text: "Liquid funds projected below $0 within 90 days, from your settled balances and recurring items.",
  },
  {
    kind: "reserve",
    text: "Liquid funds below your emergency reserve target (your months × average essential spending).",
  },
  {
    kind: "high_interest",
    text: `Debts at ${HIGH_INTEREST_APR}% APR or more, with their monthly interest at today's balance.`,
  },
  {
    kind: "budget",
    text: "Categories over this month's budget.",
  },
  {
    kind: "goal",
    text: "Goals that do not fit, in priority order, in what is available each month.",
  },
  {
    kind: "concentration",
    text: `One position above ${SINGLE_HOLDING_LIMIT_PCT}% or one sector above ${SECTOR_LIMIT_PCT}% of priced holdings.`,
  },
  {
    kind: "subscriptions",
    text: "Repeating charges that look regular but are not tracked as recurring items.",
  },
  {
    kind: "missing_input",
    text: "Inputs the other rules need: debt rates and minimums, a reserve target, essential categories, holding prices.",
  },
];

const KIND_ORDER = RULES.map((r) => r.kind);

const TAB = {
  forecast: { label: "Open Cash flow", href: "#/money/forecast" },
  debts: { label: "Open Debts", href: "#/money/debts" },
  budgets: { label: "Open Budgets & bills", href: "#/money/budgets" },
  goals: { label: "Open Goals", href: "#/money/goals" },
  holdings: { label: "Open Holdings", href: "#/money/holdings" },
  accounts: { label: "Open Accounts", href: "#/money/accounts" },
};

const pct = (n: number) => `${n.toFixed(1)}%`;

function shortfall(state: MoneyState, asOf: string): ActionItem[] {
  if (state.planning.recurring.length === 0) return [];
  const f = projectCashFlow(state, { asOf, horizonDays: 90 });
  if (!f.first_below_zero) return [];
  const needed = -f.lowest.cents;
  return [
    {
      id: `shortfall:${f.first_below_zero}`,
      kind: "shortfall",
      priority: 1,
      title: `Liquid funds are projected to fall below $0 on ${f.first_below_zero}`,
      reason:
        "Your settled liquid balances plus the recurring income and bills you entered go below $0 within 90 days. " +
        "Spending that is not set up as recurring is not included, so the real low point may be lower.",
      figures: [
        {
          label: "Liquid funds today (settled)",
          value: formatCents(f.confirmed_liquid_cents),
        },
        {
          label: "Lowest projected",
          value: formatCents(f.lowest.cents),
          note: f.lowest.date,
        },
      ],
      impact:
        `An extra ${formatCents(needed)} in liquid accounts before ${f.first_below_zero} ` +
        `would keep this projection at or above $0 through ${f.end_date}.`,
      tradeoffs: [
        "Moving money out of savings or investments can have costs or tax effects.",
        "Paying a bill late to cover the gap can add fees or interest; check its terms first.",
      ],
      link: TAB.forecast,
    },
  ];
}

function reserve(state: MoneyState, asOf: string): ActionItem[] {
  const input = liquidityInputs(state, asOf);
  const target = state.planning.profile.emergency_months_target;
  if (target == null || target <= 0) {
    return [
      {
        id: "missing:reserve_target",
        kind: "missing_input",
        priority: 3,
        title: "Set an emergency reserve target",
        reason:
          "Without a target, the app cannot say how much of your liquid funds to keep back before extra debt payments or purchases.",
        figures: [],
        impact: null,
        tradeoffs: [],
        link: {
          label: "Set it on Holdings (your profile)",
          href: TAB.holdings.href,
        },
      },
    ];
  }
  const check = liquidityCheck(input);
  if (check.reserve_cents == null) {
    // Target set, essential spending not measurable yet. Only one cause is
    // something the user can fix today: no category marked essential.
    if (input.essential_monthly_cents === 0) {
      return [
        {
          id: "missing:essential_categories",
          kind: "missing_input",
          priority: 3,
          title: "Mark which spending categories are essential",
          reason: check.reason ?? "",
          figures: [],
          impact: null,
          tradeoffs: [],
          link: TAB.budgets,
        },
      ];
    }
    return [];
  }
  if (input.liquid_cents >= check.reserve_cents) return [];
  const gap = check.reserve_cents - input.liquid_cents;
  return [
    {
      id: "reserve",
      kind: "reserve",
      priority: 2,
      title: "Liquid funds are below your reserve target",
      reason:
        `Your target is ${target} month(s) of essential spending: ` +
        `${formatCents(input.essential_monthly_cents ?? 0)} a month, averaged over ${input.months_used} complete month(s).`,
      figures: [
        {
          label: "Liquid funds (settled)",
          value: formatCents(input.liquid_cents),
        },
        { label: "Reserve target", value: formatCents(check.reserve_cents) },
        { label: "Below target by", value: formatCents(gap) },
      ],
      impact: `${formatCents(gap)} more in liquid accounts would reach the target.`,
      tradeoffs: [
        "Money kept in reserve is not paying down debt or invested.",
        "The target is your own choice; you can change it in your profile.",
      ],
      link: TAB.debts,
    },
  ];
}

function debts(state: MoneyState, asOf: string): ActionItem[] {
  const { debts: open } = debtsFromState(state, asOf);
  const { missing } = partitionDebts(open);
  const out: ActionItem[] = [];
  for (const d of open) {
    if (d.apr == null || d.apr < HIGH_INTEREST_APR) continue;
    const monthly = Math.round((d.balance_cents * d.apr) / 100 / 12);
    const per100 = Math.round((10_000 * d.apr) / 100 / 12);
    out.push({
      id: `high_interest:${d.id}`,
      kind: "high_interest",
      priority: 2,
      title: `${d.name} charges ${d.apr}% APR`,
      reason: `Debts at ${HIGH_INTEREST_APR}% APR or more are listed. At today's balance this one adds about ${formatCents(monthly)} of interest a month.`,
      figures: [
        { label: "Balance", value: formatCents(d.balance_cents) },
        { label: "APR", value: `${d.apr}%` },
        {
          label: "Interest a month (estimate)",
          value: formatCents(monthly),
          note: "balance × APR ÷ 12",
        },
      ],
      impact: `Each $100 paid off lowers the interest by about ${formatCents(per100)} a month at this rate.`,
      tradeoffs: [
        "Extra payments lower your liquid funds; check your reserve first.",
        "A debt with fees, or a promotional rate about to end, may matter more than the rate alone.",
      ],
      link: TAB.debts,
    });
  }
  for (const m of missing) {
    out.push({
      id: `missing:debt:${m.id}`,
      kind: "missing_input",
      priority: 3,
      title: `${m.name}: add its ${m.missing.join(" and ")}`,
      reason:
        "Payoff plans and interest estimates leave this debt out until these are entered, rather than assuming zero.",
      figures: [],
      impact: null,
      tradeoffs: [],
      link: TAB.accounts,
    });
  }
  return out;
}

function budgets(state: MoneyState, asOf: string): ActionItem[] {
  const month = asOf.slice(0, 7);
  const r = budgetReport(state, state.planning, month, asOf);
  return r.rows
    .filter((row) => row.status === "over")
    .map((row) => ({
      id: `budget:${row.category}:${month}`,
      kind: "budget" as const,
      priority: 2 as const,
      title: `${row.category} is over this month's budget`,
      reason: "Settled spending this month is above the monthly limit you set.",
      figures: [
        { label: "Spent", value: formatCents(row.actual_cents) },
        { label: "Limit", value: formatCents(row.limit_cents) },
        { label: "Over by", value: formatCents(-row.remaining_cents) },
      ],
      impact: null,
      tradeoffs: [
        "A limit that is regularly exceeded may be set too low for real costs.",
      ],
      link: TAB.budgets,
    }));
}

function goals(state: MoneyState, asOf: string): ActionItem[] {
  if (state.planning.goals.length === 0) return [];
  const f = feasibility(state, asOf);
  return f.rows
    .filter((row) => row.fits === false)
    .map((row) => ({
      id: `goal:${row.progress.goal.id}`,
      kind: "goal" as const,
      priority: 2 as const,
      title: `${row.progress.goal.name} does not fit in what is available`,
      reason: row.note,
      figures: [
        ...(row.needed_cents != null
          ? [{ label: "Needs a month", value: formatCents(row.needed_cents) }]
          : []),
        ...(row.shortfall_cents != null
          ? [
              {
                label: "Short by a month",
                value: formatCents(row.shortfall_cents),
              },
            ]
          : []),
      ],
      impact: row.fits_by_date
        ? `With what is left after higher priorities, it could be reached by ${row.fits_by_date}.`
        : null,
      tradeoffs: [
        "The levers are the date, the amount, and the priority order; each one moves another goal.",
      ],
      link: TAB.goals,
    }));
}

function holdings(state: MoneyState, asOf: string): ActionItem[] {
  if (state.planning.holdings.length === 0) return [];
  const p = portfolio(state, asOf);
  const c = concentration(p, state.planning.profile);
  const out: ActionItem[] = [];
  const note =
    "This describes your holdings; it is not advice to buy or sell anything.";
  if (c.single_flag && c.largest) {
    out.push({
      id: `concentration:single:${c.largest.label}`,
      kind: "concentration",
      priority: 3,
      title: `${c.largest.label} is ${pct(c.largest.pct)} of your priced holdings`,
      reason: `Single positions above ${SINGLE_HOLDING_LIMIT_PCT}% of priced holdings are noted. ${note}`,
      figures: [
        {
          label: "Value at your prices",
          value: formatCents(c.largest.value_cents),
        },
        { label: "Share of priced holdings", value: pct(c.largest.pct) },
      ],
      impact: null,
      tradeoffs: [
        "A fund holding many companies is diversified inside itself, even as one position.",
        "Selling can have tax effects and costs.",
      ],
      link: TAB.holdings,
    });
  }
  if (c.sector_flag && c.largest_sector) {
    out.push({
      id: `concentration:sector:${c.largest_sector.label}`,
      kind: "concentration",
      priority: 3,
      title: `${c.largest_sector.label} is ${pct(c.largest_sector.pct)} of your priced holdings`,
      reason: `Sectors above ${SECTOR_LIMIT_PCT}% of priced holdings are noted. ${note}`,
      figures: [
        {
          label: "Value at your prices",
          value: formatCents(c.largest_sector.value_cents),
        },
        {
          label: "Share of priced holdings",
          value: pct(c.largest_sector.pct),
        },
      ],
      impact: null,
      tradeoffs: ["Sector labels are the ones you entered."],
      link: TAB.holdings,
    });
  }
  if (p.unvalued_count > 0) {
    out.push({
      id: "missing:holding_prices",
      kind: "missing_input",
      priority: 3,
      title: `${p.unvalued_count} holding(s) have no dated price`,
      reason:
        "Their value is unknown, so they are left out of every percentage rather than counted as zero.",
      figures: [],
      impact: null,
      tradeoffs: [],
      link: TAB.holdings,
    });
  }
  const stale = p.rows.filter((r) => r.stale).length;
  if (stale > 0) {
    out.push({
      id: "missing:stale_prices",
      kind: "missing_input",
      priority: 3,
      title: `${stale} holding price(s) are more than ${STALE_PRICE_DAYS} days old`,
      reason:
        "Values and percentages use the prices you entered, on the dates you entered them.",
      figures: [],
      impact: null,
      tradeoffs: [],
      link: TAB.holdings,
    });
  }
  return out;
}

function subscriptions(state: MoneyState): ActionItem[] {
  const found = detectSubscriptionCandidates(
    state.transactions,
    state.planning.recurring,
  );
  if (found.length === 0) return [];
  const monthly = found.reduce(
    (s, c) => s + monthlyEquivalent(c.typical_amount_cents, c.cadence),
    0,
  );
  return [
    {
      id: "subscriptions",
      kind: "subscriptions",
      priority: 3,
      title: `${found.length} repeating charge(s) may be subscriptions`,
      reason:
        "Three or more charges with the same description and account, amounts within 5%, at a regular interval, " +
        "not yet tracked as recurring items. Possibilities to check, not confirmed subscriptions.",
      figures: found.slice(0, 3).map((c) => ({
        label: c.description,
        value: formatCents(c.typical_amount_cents),
        note: `${c.evidence.length} charges, ${c.confidence} confidence`,
      })),
      impact: `Together about ${formatCents(monthly)} a month at their typical amounts.`,
      tradeoffs: [
        "Tracking one as recurring puts it in your projections; it does not cancel anything.",
      ],
      link: TAB.budgets,
    },
  ];
}

/** Every action the rules produce today, most time-sensitive first. */
export function buildActions(state: MoneyState, asOf: string): ActionItem[] {
  if (!state.accounts.some((a) => !a.archived)) return [];
  const all = [
    ...shortfall(state, asOf),
    ...reserve(state, asOf),
    ...debts(state, asOf),
    ...budgets(state, asOf),
    ...goals(state, asOf),
    ...holdings(state, asOf),
    ...subscriptions(state),
  ];
  return all.sort(
    (a, b) =>
      a.priority - b.priority ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.title.localeCompare(b.title),
  );
}

export interface ActionList {
  active: ActionItem[];
  deferred: { item: ActionItem; until: string }[];
  done: ActionItem[];
  dismissed: ActionItem[];
}

/** Split actions by the user's decisions. A deferral ends on its date. */
export function applyDecisions(
  items: ActionItem[],
  decisions: Record<string, ActionDecision>,
  asOf: string,
): ActionList {
  const out: ActionList = { active: [], deferred: [], done: [], dismissed: [] };
  for (const item of items) {
    const d = decisions[item.id];
    if (!d) out.active.push(item);
    else if (d.status === "done") out.done.push(item);
    else if (d.status === "dismissed") out.dismissed.push(item);
    else if (d.until && d.until > asOf)
      out.deferred.push({ item, until: d.until });
    else out.active.push(item);
  }
  return out;
}
