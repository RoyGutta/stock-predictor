/**
 * Finley — Financial Assistant. A rule-based helper that runs entirely in this
 * browser. It is not a language model and calls no AI service: a question is
 * matched against a fixed list of topics by keywords, and each topic's answer is
 * computed from the user's own Money Manager data with the same functions the
 * rest of the app uses. Nothing is sent anywhere, and nothing is stored.
 *
 * Why rule-based: the product must not send personal financial records to an AI
 * API, and must not spend the maintainer's model credits on visitors. A fixed
 * topic list also means every answer can be tested and states its basis.
 */

import type { MoneyState } from "../money/model";

export interface Figure {
  label: string;
  /** Already formatted. "—" when it cannot be computed; the note says why. */
  value: string;
  note?: string;
}

export interface Answer {
  topic: string;
  title: string;
  /** Plain-language summary, descriptive rather than advisory. */
  text: string;
  figures: Figure[];
  /** What the figures are computed from. */
  basis: string | null;
  caveats: string[];
  links: { label: string; href: string }[];
  follow_ups: string[];
}

export interface Context {
  state: MoneyState;
  today: string; // YYYY-MM-DD
}

export interface Topic {
  id: string;
  /** Shown in the help answer and as suggestions. */
  example: string;
  /** Each entry is a set of words that must all appear; the best set scores. */
  match: string[][];
  answer: (ctx: Context) => Answer;
}

/** Words that carry no meaning for matching. */
const STOP = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "am",
  "i",
  "my",
  "me",
  "do",
  "does",
  "did",
  "what",
  "whats",
  "how",
  "much",
  "many",
  "of",
  "to",
  "in",
  "on",
  "for",
  "it",
  "can",
  "you",
  "your",
  "and",
  "or",
  "be",
  "have",
  "has",
  "there",
  "that",
]);

export function tokens(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

/** A word matches a keyword when it equals it or starts with it ("spending" ~ "spend"). */
function has(words: string[], keyword: string): boolean {
  return words.some(
    (w) => w === keyword || (keyword.length >= 4 && w.startsWith(keyword)),
  );
}

export function score(words: string[], topic: Topic): number {
  let best = 0;
  for (const set of topic.match) {
    if (set.every((k) => has(words, k))) best = Math.max(best, set.length);
  }
  return best;
}

// --- guardrails: questions Finley declines, checked before any topic --------------

interface Guardrail {
  id: string;
  test: RegExp;
  answer: Omit<Answer, "topic" | "figures" | "basis" | "follow_ups">;
}

const GUARDRAILS: Guardrail[] = [
  {
    id: "decline_trade",
    test: /\b(should|shall|must|would)\b.*\b(buy|sell|short|invest|trade)\b|\b(buy|sell)\b.*\b(now|today|stock|shares?|crypto|bitcoin)\b|\b(best|top|hot)\b.*\b(stocks?|shares|investment|crypto|etf|fund)\b/,
    answer: {
      title: "Finley does not recommend investments",
      text:
        "Finley does not say what to buy or sell, and cannot place trades. It can show what you hold, " +
        "how it is spread across asset classes and sectors, and point you to company filings to research.",
      caveats: [
        "This app is educational. It is not a registered investment adviser or broker.",
      ],
      links: [
        { label: "Your holdings", href: "#/money" },
        { label: "Research company filings", href: "#/research" },
      ],
    },
  },
  {
    id: "decline_predict",
    test: /\b(predict|prediction|forecast(ed)?|will)\b.*\b(price|market|stock|shares|crash|go up|go down|return)\b|\bguarantee/,
    answer: {
      title: "Finley does not predict markets",
      text:
        "No one can reliably predict prices or returns, and Finley does not try. It can project your " +
        "own cash flow from the recurring items you entered, labelled as a projection of your entries.",
      caveats: [],
      links: [{ label: "Cash-flow projection", href: "#/money" }],
    },
  },
  {
    id: "decline_professional",
    // "spent on taxes" is a spending question (Taxes is a category), so tax words
    // decline only alongside advice words.
    test: /\b(tax|taxes)\b.*\b(deduct\w*|owe|file|filing|bracket|advice|write.?off|avoid|reduce|lower)\b|\b(owe|file|filing|bracket|advice|avoid|reduce|lower)\b.*\b(tax|taxes)\b|\b(deduct\w*|irs|legal|lawyer|lawsuit|bankrupt\w*|estate plan\w*)\b/,
    answer: {
      title: "That needs a qualified professional",
      text:
        "Finley cannot give tax, legal, or bankruptcy guidance. For those, a licensed professional " +
        "(a CPA, enrolled agent, attorney, or nonprofit credit counselor) can look at your full situation.",
      caveats: [],
      links: [],
    },
  },
  {
    id: "decline_execute",
    test: /\b(transfer|move|send|pay|wire)\b.*\b(money|funds|\$|dollars|bill)\b.*\b(for me|now|automatically)\b|\b(log ?in|connect)\b.*\b(bank|brokerage|account)\b/,
    answer: {
      title: "Finley cannot move money or connect to banks",
      text:
        "Finley only reads the records you entered in this browser. It cannot move money, pay bills, " +
        "or connect to a bank or brokerage, and the app never asks for those credentials.",
      caveats: [],
      links: [],
    },
  },
];

export function guardrail(question: string): Answer | null {
  const text = question.toLowerCase();
  const hit = GUARDRAILS.find((g) => g.test.test(text));
  return hit
    ? { topic: hit.id, figures: [], basis: null, follow_ups: [], ...hit.answer }
    : null;
}

// --- answering --------------------------------------------------------------------

export const MAX_QUESTION = 300;

export function unmatched(topics: Topic[]): Answer {
  return {
    topic: "unmatched",
    title: "Finley did not recognize that question",
    text:
      "Finley answers a fixed set of questions about the records in your Money Manager. " +
      "Try one of these, or rephrase using words like spending, debt, net worth, budget, or goal.",
    figures: [],
    basis: null,
    caveats: [],
    links: [],
    follow_ups: topics.slice(0, 6).map((t) => t.example),
  };
}

/**
 * Answer one question. Guardrails first, then the best-scoring topic; ties go to
 * the topic listed first. Pure: the same question and data give the same answer.
 */
export function ask(question: string, ctx: Context, topics: Topic[]): Answer {
  const q = question.slice(0, MAX_QUESTION);
  const declined = guardrail(q);
  if (declined) return declined;
  const words = tokens(q);
  let best: Topic | null = null;
  let bestScore = 0;
  for (const topic of topics) {
    const s = score(words, topic);
    if (s > bestScore) {
      best = topic;
      bestScore = s;
    }
  }
  return best ? best.answer(ctx) : unmatched(topics);
}
