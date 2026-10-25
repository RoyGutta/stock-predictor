/**
 * Finley topics that read the planning modules (holdings, budgets, recurring
 * bills, goals, projections, debt strategies). Each reuses the module the
 * matching Money tab uses, so Finley and the tab always show the same numbers.
 */

import { budgetReport } from "../money/budgets";
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

/** Order matters for ties: more specific topics first. */
export const PLANNING_TOPICS: Topic[] = [
  budgets,
  bills,
  subscriptions,
  unusual,
  holdings,
];
