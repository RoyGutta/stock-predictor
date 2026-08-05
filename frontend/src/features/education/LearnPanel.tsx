import { useState } from "react";

import { Card } from "../../components/ui";
import { GLOSSARY, LEARNING_PATH, type GlossaryKey } from "./glossary";
import "./education.css";

/**
 * The starting point for someone who has never invested.
 *
 * Ordered by what you need to understand first, not alphabetically. Each entry
 * ends with what the concept does *not* tell you — usually the most useful
 * sentence, and the one most explainers omit.
 */
export function LearnPanel() {
  const [openTerm, setOpenTerm] = useState<GlossaryKey | null>(LEARNING_PATH[0]);

  return (
    <Card title="Start here" as="section" action={<span className="eyebrow">Plain English</span>}>
      <p className="learn__intro">
        No jargon, no prior knowledge assumed. Each answer also says where the idea stops
        being useful.
      </p>

      <ul className="learn__list">
        {LEARNING_PATH.map((key) => {
          const entry = GLOSSARY[key];
          const open = openTerm === key;
          return (
            <li key={key} className="learn__item">
              <button
                type="button"
                className="learn__trigger"
                aria-expanded={open}
                onClick={() => setOpenTerm(open ? null : key)}
              >
                <span className="learn__term">{entry.term}</span>
                <span className="learn__short">{entry.short}</span>
                <span className="learn__chevron" aria-hidden="true">
                  {open ? "−" : "+"}
                </span>
              </button>
              {open && (
                <div className="learn__body">
                  <p>{entry.full}</p>
                  <p className="learn__limits">{entry.limits}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
