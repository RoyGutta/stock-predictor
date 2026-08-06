import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "../../components/ui";
import { useTickerSearch } from "../../hooks/useTickerSearch";
import "./search.css";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (ticker: string) => void;
  loading: boolean;
  /** False when no search provider is configured; the input still works. */
  suggestionsEnabled: boolean;
}

/**
 * Ticker input with autocomplete.
 *
 * Implements the ARIA combobox pattern rather than a plain list: the input owns
 * the listbox, the active option is announced via aria-activedescendant, and
 * arrow keys move a virtual cursor without moving DOM focus. Typing a ticker
 * directly and pressing Enter always works, whether or not suggestions load.
 */
export function SearchBox({
  value,
  onChange,
  onSubmit,
  loading,
  suggestionsEnabled,
}: SearchBoxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const inputId = useId();
  const listId = useId();

  const { results } = useTickerSearch(value, suggestionsEnabled && open);

  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const choose = (ticker: string) => {
    onChange(ticker);
    setOpen(false);
    setActiveIndex(-1);
    onSubmit(ticker);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const chosen = activeIndex >= 0 ? results[activeIndex]?.ticker : value.trim();
    if (chosen) choose(chosen);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!results.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    }
  };

  const showList = open && suggestionsEnabled && results.length > 0;

  return (
    <div className="searchbox" ref={containerRef}>
      <form className="searchbox__form" onSubmit={handleSubmit} role="search">
        <label className="visually-hidden" htmlFor={inputId}>
          Search for a company or ticker symbol
        </label>
        <div
          className="searchbox__field-wrap"
          role="combobox"
          aria-expanded={showList}
          aria-owns={listId}
          aria-haspopup="listbox"
        >
          <input
            id={inputId}
            className="searchbox__field"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="Search a company or ticker — AAPL, Microsoft, VOO"
            value={value}
            aria-autocomplete="list"
            aria-controls={showList ? listId : undefined}
            aria-activedescendant={
              activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
            }
            onChange={(event) => {
              onChange(event.target.value.toUpperCase());
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
          />

          {showList && (
            <ul className="searchbox__list" id={listId} role="listbox">
              {results.map((result, index) => (
                <li
                  key={result.ticker}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`searchbox__option${
                    index === activeIndex ? " searchbox__option--active" : ""
                  }`}
                  // onMouseDown, not onClick: pointerdown closes the list on
                  // blur before a click would ever land.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(result.ticker);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="searchbox__ticker">{result.ticker}</span>
                  <span className="searchbox__name">{result.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button variant="primary" type="submit" disabled={loading || !value.trim()}>
          {loading ? "Loading…" : "Analyze"}
        </Button>
      </form>
    </div>
  );
}
