import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Card } from "../../components/ui";
import { todayIso, type MoneyState } from "../money/model";
import { ask, MAX_QUESTION, type Answer, type Topic } from "./engine";
import "./finley.css";

interface Exchange {
  id: number;
  question: string;
  answer: Answer;
}

function AnswerView({ answer }: { answer: Answer }) {
  return (
    <div className="finley-answer">
      <p className="finley-answer__title">{answer.title}</p>
      <p>{answer.text}</p>
      {answer.figures.length > 0 && (
        <dl className="finley-figures">
          {answer.figures.map((f) => (
            <div key={f.label} className="finley-figure">
              <dt>{f.label}</dt>
              <dd>
                <span className="finley-figure__value">{f.value}</span>
                {f.note && (
                  <span className="finley-figure__note">{f.note}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {answer.basis && (
        <p className="finley-basis">
          <strong>Basis:</strong> {answer.basis}
        </p>
      )}
      {answer.caveats.length > 0 && (
        <ul className="finley-caveats">
          {answer.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {answer.links.length > 0 && (
        <p className="finley-links">
          {answer.links.map((l) => (
            <a key={l.href + l.label} href={l.href}>
              {l.label}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Finley — Financial Assistant. Answers are computed in this browser from the
 * user's Money Manager records by a fixed set of rules (engine.ts). No question
 * or answer leaves the page, and the conversation is not saved.
 */
export function FinleyPanel({
  state,
  topics,
  today = todayIso(),
}: {
  state: MoneyState;
  topics: Topic[];
  today?: string;
}) {
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [log, setLog] = useState<Exchange[]>([]);
  const next = useRef(1);

  const submit = (text: string) => {
    const q = text.trim();
    if (!q) return;
    const answer = ask(q, { state, today }, topics);
    setLog((prev) =>
      [...prev, { id: next.current++, question: q, answer }].slice(-20),
    );
    setQuestion("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(question);
  };

  const latest = log.at(-1);
  const suggestions =
    latest && latest.answer.follow_ups.length > 0
      ? latest.answer.follow_ups
      : topics.slice(0, 6).map((t) => t.example);

  return (
    <Card title="Finley — Financial Assistant" className="finley">
      <p className="finley-intro">
        Finley answers questions about the records in your Money Manager. It is
        a rule-based helper that runs in this browser, not an AI model: your
        questions and records are not sent anywhere, and this conversation is
        not saved. It describes your numbers; it does not give investment, tax,
        or legal advice.
      </p>

      <div
        className="finley-log"
        role="log"
        aria-live="polite"
        aria-label="Conversation with Finley"
      >
        {log.length === 0 && (
          <p className="finley-empty">Ask a question, or choose one below.</p>
        )}
        {log.map((x) => (
          <div key={x.id} className="finley-exchange">
            <p className="finley-question">
              <span className="visually-hidden">You asked: </span>
              {x.question}
            </p>
            <AnswerView answer={x.answer} />
          </div>
        ))}
      </div>

      <div
        className="finley-suggestions"
        role="group"
        aria-label="Suggested questions"
      >
        {suggestions.map((s) => (
          <Button key={s} small onClick={() => submit(s)}>
            {s}
          </Button>
        ))}
      </div>

      <form className="finley-form" onSubmit={onSubmit}>
        <label htmlFor={inputId}>Your question</label>
        <div className="finley-form__row">
          <input
            id={inputId}
            type="text"
            value={question}
            maxLength={MAX_QUESTION}
            autoComplete="off"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" variant="primary">
            Ask
          </Button>
          {log.length > 0 && (
            <Button type="button" onClick={() => setLog([])}>
              Clear
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
