# Process Changelog

Self-modifications to the engineering process. One change at a time, each
reversible, each judged against its hypothesis after 1–3 cycles.

This file tracks changes to *how the work is done*. Product changes live in git
history.

---

## SM-1 | 2026-08-10

**TRIGGER**
A spelling-normalization codemod used `pathlib.rglob("*")` from the repository
root with a skip list that contained `.venv` but not `venv`. It rewrote ~120
files inside a stale Windows virtualenv before crashing on a non-UTF-8 file
(TENSIONS T-2). The blast radius was invisible until the crash.

**CHANGE**
Any scripted multi-file edit now enumerates explicit source roots
(`frontend/src`, `backend/app`, `backend/tests`, plus named root documents)
rather than walking the tree with exclusions. Allowlist, not denylist — a missing
entry then means a file is skipped, not that an unrelated directory is rewritten.

**HYPOTHESIS**
Zero unintended files modified by codemods. Verified by checking `git status`
against the expected file list before committing.

**REVERT-IF**
The explicit-roots approach starts causing repeated misses that require several
follow-up passes, indicating the enumeration is more error-prone than filtering.

**STATUS** active

---

## SM-2 | 2026-08-10

**TRIGGER**
Frontend component tests timed out at the default 5 s while dev servers and a
Playwright browser were running, producing three different results across
identical runs (TENSIONS T-5). Time was spent investigating a code defect that
did not exist.

**CHANGE**
The VERIFY step now begins by stopping background dev servers and browsers. A
flaky verification signal is treated as a blocking problem, not noise to retry
past.

**HYPOTHESIS**
Verification results become deterministic; no further time lost to phantom
failures.

**REVERT-IF**
Restarting servers each cycle costs more time than the flakiness did, or timeouts
recur with no servers running — which would mean the real cause is elsewhere and
this change masked it.

**STATUS** active, but no longer load bearing — superseded in practice by SM-3.

---

## SM-3 | 2026-08-17

**TRIGGER**
T-5 recurred. The frontend suite reported "9 errors, no tests" with dev servers
and a browser running, then passed clean on retry. SM-2 says to stop servers
before verifying; the step was missed once the suite passed 150 tests and gained
axe, which is slow. A process rule that depends on remembering will be forgotten
exactly when the suite is largest and the cost of a false red is highest.

**CHANGE**
`testTimeout` and `hookTimeout` raised to 20 s in `vitest.config.ts`, against a
real runtime of about 1 s. Where a mitigation can be encoded in configuration
rather than carried as a habit, encode it.

**HYPOTHESIS**
No further false reds from machine load. A generous timeout costs nothing on a
passing run — it only bounds how long a genuine hang takes to surface.

**REVERT-IF**
A real hang starts taking meaningfully longer to diagnose, or timeouts recur at
20 s — which would mean the cause was never contention and this masked it.

**STATUS** active. Verified over three consecutive full runs, 151 passed each.

---

## SM-4 | 2026-08-17

**TRIGGER**
`.env.example` documented three variables no code path read, one of them
describing an AI explanation feature that has never existed (LEARNINGS L-10).
It also omitted two variables the code did read. Nothing in the process checked
that the setup contract matched the code.

**CHANGE**
Whenever `config.py` or `.env.example` changes, diff the variables the code
reads against the variables the file documents — in both directions. Extract
each list mechanically rather than reading by eye; the check takes a minute and
found four defects the first time it ran.

**HYPOTHESIS**
`.env.example` stays an accurate contract. Configuration for unbuilt features
stays in ROADMAP, where being unbuilt is the point.

**REVERT-IF**
The check produces repeated false positives from indirect variable reads, making
it noise rather than signal.

**STATUS** active
