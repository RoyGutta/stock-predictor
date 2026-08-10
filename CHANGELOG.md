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

**STATUS** active
