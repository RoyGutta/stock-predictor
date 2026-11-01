import { useState } from "react";

import { Button, Card, Stat } from "../../components/ui";
import {
  applyDecisions,
  buildActions,
  DEFER_DAYS,
  PRIORITY_LABELS,
  RULES,
  type ActionItem,
  type ActionPriority,
} from "./actions";
import type { PlanningUpdate } from "./BudgetsView";
import { todayIso, type MoneyState } from "./model";
import type { ActionDecision } from "./planning";
import { addDays } from "./recurring";

/** A glyph next to each priority, so it never rests on color alone. */
const PRIORITY_GLYPH: Record<ActionPriority, string> = {
  1: "▲",
  2: "●",
  3: "○",
};

/**
 * The action list: what the rules found in the user's own records, why, and
 * what acting would change. Decisions are kept with the rest of the planning
 * data, in this browser only.
 */
export function ActionsView({
  state,
  onPlanning,
  today = todayIso(),
}: {
  state: MoneyState;
  onPlanning: PlanningUpdate;
  today?: string;
}) {
  const [message, setMessage] = useState("");
  const items = buildActions(state, today);
  const list = applyDecisions(items, state.planning.action_decisions, today);
  const hasAccounts = state.accounts.some((a) => !a.archived);

  const decide = (item: ActionItem, status: ActionDecision["status"]) => {
    const until = status === "deferred" ? addDays(today, DEFER_DAYS) : null;
    onPlanning((p) => ({
      ...p,
      action_decisions: {
        ...p.action_decisions,
        [item.id]: { status, until, decided_on: today },
      },
    }));
    setMessage(
      status === "done"
        ? `Marked done: ${item.title}.`
        : status === "dismissed"
          ? `Dismissed: ${item.title}.`
          : `Hidden until ${until}: ${item.title}.`,
    );
  };
  const restore = (item: ActionItem) => {
    onPlanning((p) => {
      const next = { ...p.action_decisions };
      delete next[item.id];
      return { ...p, action_decisions: next };
    });
    setMessage(`Back on the list: ${item.title}.`);
  };

  return (
    <>
      <Card title="Actions">
        <p className="money-basis">
          Rules applied to your own records. Each item says which rule found it,
          the figures behind it, what acting would change where that can be
          computed, and the trade-offs. These are prompts to look at your
          numbers, not financial advice, and nothing here recommends buying or
          selling a security.
        </p>
        {hasAccounts && (
          <div className="money-stats">
            <Stat label="Open" value={String(list.active.length)} />
            <Stat label="Hidden for now" value={String(list.deferred.length)} />
            <Stat label="Done" value={String(list.done.length)} />
            <Stat label="Dismissed" value={String(list.dismissed.length)} />
          </div>
        )}
        <p role="status" className="money-sub">
          {message}
        </p>
        {!hasAccounts ? (
          <p>
            Add an account first: every rule works from your recorded balances
            and transactions. <a href="#/money/accounts">Open Accounts</a>
          </p>
        ) : list.active.length === 0 ? (
          <p>Nothing needs attention under these rules today.</p>
        ) : (
          <ol className="money-list actions-list">
            {list.active.map((item, i) => (
              <ActionCard
                key={item.id}
                item={item}
                headingId={`action-${i}`}
                onDecide={decide}
              />
            ))}
          </ol>
        )}
      </Card>

      {list.deferred.length + list.done.length + list.dismissed.length > 0 && (
        <Card title="Set aside">
          <ul className="money-list">
            {list.deferred.map(({ item, until }) => (
              <SetAside
                key={item.id}
                item={item}
                status={`Hidden until ${until}`}
                onRestore={restore}
              />
            ))}
            {list.done.map((item) => (
              <SetAside
                key={item.id}
                item={item}
                status="Marked done"
                onRestore={restore}
              />
            ))}
            {list.dismissed.map((item) => (
              <SetAside
                key={item.id}
                item={item}
                status="Dismissed"
                onRestore={restore}
              />
            ))}
          </ul>
          <p className="money-basis">
            An item marked done stays here while the rule still finds it, so you
            can see whether the change has shown up in your records yet.
          </p>
        </Card>
      )}

      <Card title="How this list is made">
        <ol className="money-basis">
          {RULES.map((r) => (
            <li key={r.kind}>{r.text}</li>
          ))}
        </ol>
        <p className="money-basis">
          The rules use the same calculations as the other tabs. A rule that
          needs an input you have not entered says so instead of guessing.
        </p>
      </Card>
    </>
  );
}

function ActionCard({
  item,
  headingId,
  onDecide,
}: {
  item: ActionItem;
  headingId: string;
  onDecide: (item: ActionItem, status: ActionDecision["status"]) => void;
}) {
  return (
    <li className="money-item">
      <div className="money-item__head">
        <h3 id={headingId} className="money-item__name">
          {item.title}
        </h3>
        <span className="money-tag">
          <span aria-hidden="true">{PRIORITY_GLYPH[item.priority]} </span>
          {PRIORITY_LABELS[item.priority]}
        </span>
      </div>
      <p>{item.reason}</p>
      {item.figures.length > 0 && (
        <dl className="actions-figures">
          {item.figures.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                {f.value}
                {f.note && <span className="money-sub"> ({f.note})</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {item.impact && (
        <p>
          <strong>If you act:</strong> {item.impact}
        </p>
      )}
      {item.tradeoffs.length > 0 && (
        <div>
          <strong>Trade-offs:</strong>
          <ul>
            {item.tradeoffs.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="money-actions">
        <a href={item.link.href}>{item.link.label}</a>
        <Button
          small
          aria-describedby={headingId}
          onClick={() => onDecide(item, "done")}
        >
          Mark done
        </Button>
        <Button
          small
          aria-describedby={headingId}
          onClick={() => onDecide(item, "deferred")}
        >
          Hide for {DEFER_DAYS} days
        </Button>
        <Button
          small
          aria-describedby={headingId}
          onClick={() => onDecide(item, "dismissed")}
        >
          Dismiss
        </Button>
      </div>
    </li>
  );
}

function SetAside({
  item,
  status,
  onRestore,
}: {
  item: ActionItem;
  status: string;
  onRestore: (item: ActionItem) => void;
}) {
  return (
    <li className="money-item">
      <div className="money-item__head">
        <span>
          {item.title} <span className="money-sub">({status})</span>
        </span>
        <Button
          small
          aria-label={`Put back: ${item.title}`}
          onClick={() => onRestore(item)}
        >
          Put back
        </Button>
      </div>
    </li>
  );
}
