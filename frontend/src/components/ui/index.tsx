/**
 * Shared UI primitives.
 *
 * Small and unopinionated on purpose: they own presentation, never data
 * fetching or business logic. Everything reads from the design tokens, so
 * neither theme is special-cased in a component.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { GLOSSARY, type GlossaryKey } from "../../features/education/glossary";
import "./ui.css";

// --- button ----------------------------------------------------------------

type ButtonVariant = "default" | "primary" | "ghost";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
}

export function Button({
  variant = "default",
  small = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    "button",
    variant !== "default" ? `button--${variant}` : "",
    small ? "button--small" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={classes} {...props} />;
}

// --- card ------------------------------------------------------------------

interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "aside" | "div";
}

export function Card({ title, action, children, className = "", as: Tag = "section" }: CardProps) {
  return (
    <Tag className={`card ${className}`.trim()}>
      {(title || action) && (
        <header className="card__header">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {action}
        </header>
      )}
      {children}
    </Tag>
  );
}

// --- stat ------------------------------------------------------------------

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  /** Colours the value. Omit for figures that carry no direction. */
  tone?: "positive" | "negative";
  term?: GlossaryKey;
}

export function Stat({ label, value, note, tone, term }: StatProps) {
  const toneClass = tone ? ` stat__value--${tone}` : "";
  return (
    <div className="stat">
      <span className="stat__label">
        {label}
        {term && <InfoTip term={term} />}
      </span>
      <span className={`stat__value numeric${toneClass}`}>{value}</span>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

// --- info tip --------------------------------------------------------------

/**
 * A definition for one glossary term, on hover or focus.
 *
 * Uses a real button rather than `title`, so it is reachable by keyboard and
 * announced by screen readers — `title` is neither.
 */
export function InfoTip({ term }: { term: GlossaryKey }) {
  const entry = GLOSSARY[term];
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span
      className="infotip"
      ref={container}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="infotip__trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`What is ${entry.term}?`}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span className="infotip__panel" id={panelId} role="tooltip">
          <strong className="infotip__term">{entry.term}</strong>
          <span className="infotip__body">
            {entry.short}
            <span className="infotip__limits">{entry.limits}</span>
          </span>
        </span>
      )}
    </span>
  );
}

// --- skeleton --------------------------------------------------------------

export function Skeleton({
  height = 16,
  width = "100%",
}: {
  height?: number | string;
  width?: number | string;
}) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

// --- callout ---------------------------------------------------------------

interface CalloutProps {
  children: ReactNode;
  tone?: "note" | "error" | "accent";
  role?: "alert" | "note";
}

export function Callout({ children, tone = "note", role }: CalloutProps) {
  return (
    <div className={`callout callout--${tone}`} role={role}>
      {children}
    </div>
  );
}
