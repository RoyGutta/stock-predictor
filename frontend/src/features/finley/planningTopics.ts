/**
 * Finley topics that read the planning modules (holdings, budgets, recurring
 * bills, goals, projections, debt strategies). Each reuses the module the
 * matching Money tab uses, so Finley and the tab always show the same numbers.
 */

import {
  applyDecisions,
  buildActions,
  PRIORITY_LABELS,
} from "../money/actions";
import { budgetReport } from "../money/budgets";
import { compareResults, debtsFromState, planDebts } from "../money/debtPlan";
import { projectCashFlow } from "../money/forecast";
import { feasibility } from "../money/goals";
import { concentration, portfolio, STALE_PRICE_DAYS } from "../money/holdings";
import { formatCents } from "../money/model";
import {
  detectSubscriptionCandidates,
  unusualCategoryChanges,
  upcoming,
} from "../money/recurring";
import { base, needsAccounts } from "./coreTopics";
import type { Topic } from "./engine";

const holdings: Topic = {
  id: "holdings",
  example: "How are my investments spread out?",
  match: [
    ["holding"],
    ["investment"],
    ["portfolio"],
    ["allocation"],
    ["diversif"],
    ["concentrat"],
    ["stocks", "bonds"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "holdings", "Investment holdings");
    if (empty) return empty;
    const a = base("holdings", "Investment holdings");
    if (ctx.state.planning.holdings.length === 0) {
      a.text =
        "You have not entered any holdings. Add them on the Holdings tab with the price and date you want to value them at.";
      return a;
    }
    const p = portfolio(ctx.state, ctx.today);
    const c = concentration(p, ctx.state.planning.profile);
    const stale = p.rows.filter((r) => r.stale).length;
    a.text =
      p.valued_count === 0
        ? "None of your holdings has a dated price yet, so their value and allocation cannot be computed."
        : `Your ${p.valued_count} priced holding(s) are worth ${formatCents(p.total_valued_cents)} at the prices you entered.`;
    a.figures = [
      {
        label: "Value of priced holdings",
        value: p.valued_count ? formatCents(p.total_valued_cents) : "—",
      },
      ...p.by_class
        .slice(0, 4)
        .map((s) => ({ label: s.label, value: `${s.pct.toFixed(1)}%` })),
    ];
    if (c.largest)
      a.figures.push({
        label: "Largest position",
        value: `${c.largest.pct.toFixed(1)}%`,
        note: c.largest.label,
      });
    a.basis =
      "Quantity × the price you entered, on the date you entered it. This app does not look up prices for your holdings.";
    a.caveats.push(...c.findings);
    if (p.unvalued_count)
      a.caveats.push(
        `${p.unvalued_count} holding(s) have no dated price and are left out of the percentages.`,
      );
    if (stale)
      a.caveats.push(
        `${stale} price(s) are more than ${STALE_PRICE_DAYS} days old.`,
      );
    if (p.excluded.length)
      a.caveats.push(
        `${p.excluded.length} holding(s) are not in U.S.-dollar accounts and are left out.`,
      );
    return a;
  },
};

const budgets: Topic = {
  id: "budgets",
  example: "Am I within my budgets?",
  match: [["budget"], ["over", "limit"], ["overspen"]],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "budgets", "Budgets this month");
    if (empty) return empty;
    const a = base("budgets", "Budgets this month");
    const month = ctx.today.slice(0, 7);
    const r = budgetReport(ctx.state, ctx.state.planning, month, ctx.today);
    if (r.rows.length === 0) {
      a.text =
        "You have no budgets that apply to this month. You can set monthly limits by category on the Budgets tab.";
      return a;
    }
    const over = r.rows.filter((row) => row.status === "over");
    const near = r.rows.filter((row) => row.status === "near");
    a.text =
      `Of ${r.rows.length} budget(s) this month, ${over.length} ${over.length === 1 ? "is" : "are"} over the limit ` +
      `and ${near.length} ${near.length === 1 ? "is" : "are"} at 85% or more.`;
    a.figures = r.rows.map((row) => ({
      label: row.category,
      value: `${formatCents(row.actual_cents)} of ${formatCents(row.limit_cents)}`,
      note:
        row.status === "over"
          ? `Over by ${formatCents(-row.remaining_cents)}.`
          : row.status === "near"
            ? `Near the limit: ${formatCents(row.remaining_cents)} left.`
            : `${formatCents(row.remaining_cents)} left.`,
    }));
    a.basis = `Settled spending from ${r.period.start} through ${r.period.through ?? r.period.start}, against the monthly limits you set.`;
    if (r.unbudgeted_total_cents > 0)
      a.caveats.push(
        `${formatCents(r.unbudgeted_total_cents)} was spent in categories without a budget.`,
      );
    return a;
  },
};

const bills: Topic = {
  id: "bills",
  example: "What bills are coming up?",
  match: [
    ["bill"],
    ["upcoming"],
    ["due"],
    ["recurring"],
    ["coming", "up"],
    ["rent"],
  ],
  answer: (ctx) => {
    const a = base("bills", "Coming up in the next 30 days");
    const items = ctx.state.planning.recurring;
    if (items.length === 0) {
      a.text =
        "You have not entered any recurring bills or income. Add them on the Budgets tab to see what is coming up.";
      return a;
    }
    const due = upcoming(items, ctx.today, 30);
    const out = due.filter((u) => u.item.kind === "expense");
    const inflow = due.filter((u) => u.item.kind === "income");
    const sum = (list: typeof due) =>
      list.reduce((s, u) => s + u.item.amount_cents, 0);
    a.text =
      due.length === 0
        ? "Nothing you entered as recurring is due in the next 30 days."
        : `${out.length} bill(s) totalling ${formatCents(sum(out))} and ${inflow.length} income item(s) totalling ${formatCents(sum(inflow))} are due in the next 30 days.`;
    a.figures = due.slice(0, 8).map((u) => ({
      label: `${u.date} · ${u.item.description || u.item.category}`,
      value: formatCents(u.item.amount_cents),
      note: `${u.item.kind}${u.item.certainty === "estimated" ? ", estimated amount" : ""}`,
    }));
    a.basis = `Your recurring items, expanded by their schedules from ${ctx.today} for 30 days.`;
    if (due.length > 8)
      a.caveats.push(`${due.length - 8} more are not shown here.`);
    if (due.some((u) => u.item.certainty === "estimated"))
      a.caveats.push(
        "Estimated amounts can differ from what is actually charged.",
      );
    return a;
  },
};

const subscriptions: Topic = {
  id: "subscriptions",
  example: "Do I have subscriptions I am not tracking?",
  match: [["subscription"], ["repeat", "charge"], ["same", "charge"]],
  answer: (ctx) => {
    const a = base("subscriptions", "Possible recurring charges");
    const found = detectSubscriptionCandidates(
      ctx.state.transactions,
      ctx.state.planning.recurring,
    );
    if (found.length === 0) {
      a.text =
        "No untracked repeating charges were found: Finley looks for three or more charges with the same description, account, and amount (within 5%) at a regular interval.";
      return a;
    }
    a.text = `${found.length} repeating charge(s) look regular but are not tracked as recurring items. These are possibilities to check, not confirmed subscriptions.`;
    a.figures = found.slice(0, 6).map((c) => ({
      label: c.description,
      value: formatCents(c.typical_amount_cents),
      note: `${c.evidence.length} charges about ${c.median_interval_days} days apart; ${c.confidence} confidence.`,
    }));
    a.basis = "Your recorded expenses grouped by description and account.";
    return a;
  },
};

const unusual: Topic = {
  id: "unusual",
  example: "Did my spending change last month?",
  match: [
    ["unusual"],
    ["spike"],
    ["unusual", "last", "month"],
    ["spen", "change", "month"],
    ["spen", "increase", "month"],
    ["more", "than", "usual"],
  ],
  answer: (ctx) => {
    const a = base("unusual", "Spending changes last month");
    const r = unusualCategoryChanges(ctx.state, ctx.today);
    if (r.unavailable_reason) {
      a.text = r.unavailable_reason;
      return a;
    }
    a.text =
      r.changes.length === 0
        ? `No category in ${r.month} was both 50% and $50 above its recent average.`
        : `${r.changes.length} category(ies) in ${r.month} were at least 50% and $50 above their recent average.`;
    a.figures = r.changes.map((c) => ({
      label: c.category,
      value: formatCents(c.last_month_cents),
      note: `Average ${formatCents(c.baseline_average_cents)} in ${r.baseline_months.join(", ")}; up ${formatCents(c.increase_cents)}.`,
    }));
    a.basis = `${r.month} compared with the average of ${r.baseline_months.join(", ")}. Months before tracking began or without spending are left out.`;
    return a;
  },
};

const debtStrategy: Topic = {
  id: "debt_strategy",
  example: "Compare debt payoff strategies",
  match: [
    ["avalanche"],
    ["snowball"],
    ["debt", "strateg"],
    ["debt", "first"],
    ["debt", "faster"],
    ["payoff", "strateg"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "debt_strategy", "Debt payoff strategies");
    if (empty) return empty;
    const a = base("debt_strategy", "Debt payoff strategies");
    const source = debtsFromState(ctx.state, ctx.today);
    if (source.debts.length === 0) {
      a.text = "You have no debts with a balance owed.";
      return a;
    }
    const plan = planDebts(source.debts, source.default_budget_cents);
    const av = plan.results.avalanche;
    const sb = plan.results.snowball;
    const cmp = compareResults(av, sb);
    const describe = (r: typeof av) =>
      r.feasible
        ? `${r.months} months, ${formatCents(r.total_interest_cents)} interest`
        : (r.reason ?? "Not feasible");
    a.text = !av.feasible
      ? `At ${formatCents(plan.budget_cents)} a month, the debts cannot be paid off: ${av.reason ?? "the payments do not cover the interest."}`
      : `At ${formatCents(plan.budget_cents)} a month, paying the highest rate first takes ${av.months} months and ` +
        `paying the smallest balance first takes ${sb.months}; the interest differs by ` +
        `${formatCents(Math.abs(cmp.interest_difference_cents ?? 0))}.`;
    a.figures = [
      {
        label: "Monthly amount for debts",
        value: formatCents(plan.budget_cents),
        note: "Your planned payments, or minimums where none is planned.",
      },
      { label: "Highest rate first", value: describe(av) },
      { label: "Smallest balance first", value: describe(sb) },
    ];
    a.basis =
      "Month-by-month simulation: interest = balance × APR ÷ 12, minimums paid on every debt, the rest to the target debt, and a paid-off debt's payment rolls to the next.";
    for (const m of plan.missing)
      a.caveats.push(
        `${m.name} is left out: missing ${m.missing.join(" and ")}.`,
      );
    a.caveats.push(
      "Both are ways to order payments; which suits you can depend on more than interest. The Debts tab lets you try other amounts and your own order.",
    );
    return a;
  },
};

const goals: Topic = {
  id: "goals",
  example: "Am I on track for my goals?",
  match: [["goal"], ["on", "track"], ["saving", "for"], ["afford", "goal"]],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "goals", "Goals");
    if (empty) return empty;
    const a = base("goals", "Goals");
    if (ctx.state.planning.goals.length === 0) {
      a.text =
        "You have not set any goals. You can add them on the Goals tab with a target amount and, optionally, a date.";
      return a;
    }
    const f = feasibility(ctx.state, ctx.today);
    const conflicts = f.rows.filter((r) => r.fits === false);
    a.text =
      f.available_cents == null
        ? `You have ${f.rows.length} goal(s). ${f.available_reason ?? "What is available each month cannot be computed yet."}`
        : `About ${formatCents(f.available_cents)} a month is available after spending and commitments; ` +
          `the goals need ${formatCents(f.total_needed_cents)}. ` +
          (conflicts.length
            ? `${conflicts.length} goal(s) do not fit in priority order.`
            : "In priority order, every assessed goal fits.");
    a.figures = f.rows.map((r) => ({
      label: r.progress.goal.name,
      value: `${Math.round(r.progress.progress * 100)}% funded`,
      note: `${r.progress.status_text}${r.needed_cents != null ? ` Needs ${formatCents(r.needed_cents)} a month.` : ""}`,
    }));
    a.basis =
      f.months.length > 0
        ? `Average income minus spending over ${f.months.join(", ")}, minus recurring commitments not already in spending. No investment return is assumed.`
        : "No complete tracked months yet.";
    return a;
  },
};

const projection: Topic = {
  id: "projection",
  example: "Will my cash run short in the next 90 days?",
  match: [
    ["run", "out"],
    ["run", "short"],
    ["shortfall"],
    ["next", "days"],
    ["cash", "flow"],
    ["projection"],
    ["low", "balance"],
    ["overdraw"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "projection", "Cash-flow projection");
    if (empty) return empty;
    const a = base("projection", "Cash-flow projection, next 90 days");
    if (ctx.state.planning.recurring.length === 0) {
      a.text =
        "A projection needs your recurring income and bills, and none are entered. Add them on the Budgets tab.";
      return a;
    }
    const f = projectCashFlow(ctx.state, { asOf: ctx.today, horizonDays: 90 });
    a.text = f.first_below_zero
      ? `Based on your recurring items, your liquid funds would fall below zero on ${f.first_below_zero}.`
      : `Based on your recurring items, your liquid funds stay above zero; the lowest point is ${formatCents(f.lowest.cents)} on ${f.lowest.date}.`;
    a.figures = [
      {
        label: "Liquid funds today (settled)",
        value: formatCents(f.confirmed_liquid_cents),
      },
      {
        label: "Lowest projected",
        value: formatCents(f.lowest.cents),
        note: f.lowest.date,
      },
      {
        label: "Projected on " + f.end_date,
        value: formatCents(f.money_left_cents),
      },
    ];
    a.basis = `Today's settled liquid balances plus your recurring items from ${f.as_of} to ${f.end_date}. ${f.fixed_count} fixed and ${f.estimated_count} estimated item(s).`;
    a.caveats.push(
      "This is a projection of the items you entered, not a prediction. Spending that is not set up as recurring is not included.",
    );
    if (f.pending.transactions.length)
      a.caveats.push(
        `${f.pending.transactions.length} pending transaction(s) are not included in the settled balance.`,
      );
    return a;
  },
};

const actions: Topic = {
  id: "actions",
  example: "What needs my attention?",
  match: [
    ["action"],
    ["attention"],
    ["priorit"],
    ["focus"],
    ["next", "step"],
    ["should", "next"],
  ],
  answer: (ctx) => {
    const empty = needsAccounts(ctx, "actions", "What needs attention");
    if (empty) return empty;
    const a = base("actions", "What needs attention");
    const list = applyDecisions(
      buildActions(ctx.state, ctx.today),
      ctx.state.planning.action_decisions,
      ctx.today,
    );
    a.text =
      list.active.length === 0
        ? "Nothing needs attention under the action rules today."
        : `${list.active.length} item(s) on your action list, most time-sensitive first.`;
    a.figures = list.active.slice(0, 5).map((item) => ({
      label: item.title,
      value: PRIORITY_LABELS[item.priority],
      ...(item.impact ? { note: item.impact } : {}),
    }));
    a.basis =
      "The action list's rules applied to your own records. The Actions tab shows each item's rule, figures, and trade-offs.";
    if (list.active.length > 5)
      a.caveats.push(`${list.active.length - 5} more on the Actions tab.`);
    const aside = list.deferred.length + list.dismissed.length;
    if (aside > 0)
      a.caveats.push(`${aside} item(s) you set aside are not counted here.`);
    a.caveats.push(
      "These are prompts to look at your numbers, not financial advice.",
    );
    return a;
  },
};

/**
 * Link each answer to the Money tab that shows the same numbers, or to Accounts
 * while there is no account to compute from.
 */
function onTab(topic: Topic, label: string, section: string): Topic {
  return {
    ...topic,
    answer: (ctx) => {
      const a = topic.answer(ctx);
      a.links = ctx.state.accounts.some((acc) => !acc.archived)
        ? [{ label, href: `#/money/${section}` }]
        : [{ label: "Add an account", href: "#/money/accounts" }];
      return a;
    },
  };
}

/** Order matters for ties: more specific topics first. */
export const PLANNING_TOPICS: Topic[] = [
  onTab(actions, "Open Actions", "actions"),
  onTab(projection, "Open Cash flow", "forecast"),
  onTab(goals, "Open Goals", "goals"),
  onTab(debtStrategy, "Open Debts", "debts"),
  onTab(budgets, "Open Budgets & bills", "budgets"),
  onTab(bills, "Open Budgets & bills", "budgets"),
  onTab(subscriptions, "Open Budgets & bills", "budgets"),
  onTab(unusual, "Open Budgets & bills", "budgets"),
  onTab(holdings, "Open Holdings", "holdings"),
];
