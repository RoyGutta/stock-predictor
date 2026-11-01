# Stock Predictor — Engineering Operating Procedure

Default workflow for this repository. Applies to every task unless explicitly
overridden in a later message.

**Read first, every session:** `STATE.md`, `TENSIONS.md`, `METRICS.json`.
This file is the project-specific form of a general operating procedure the
maintainer keeps outside the repository.

---

## Mission

**Objective** — a production-quality, publicly publishable educational investing
platform: robust data ingestion, evaluation, visualization, testing, security,
documentation.

**Success metric** — validated out-of-sample performance and system reliability,
without breaking what works.

> The "out-of-sample" half is measured by **walk-forward backtesting of indicator
> rules** (`app/analytics/backtest.py`), not by a price forecaster — see
> `TENSIONS.md` T-1 for why. Note the caveat in `METRICS.json`: backtest *returns*
> are facts about the market, not about this system. Tuning rules to improve them
> would be the data mining the engine exists to expose. Our metric is the
> *validity* of the measurement plus system reliability.

**Pipeline** — React/Vite frontend → FastAPI backend → market data →
feature engineering → analysis → evaluation → visualization.

---

## Hard constraints — never violate

1. **No secrets committed.** Ever. Not in code, logs, tests, or docs.
2. **Preserve working functionality** unless there is a justified reason to change it.
3. **Never fabricate** metrics, test results, model performance, data, or completion status.
4. **Verify with tests.** "Done" means verified, not attempted.
5. **Keep the repo safe to publish publicly.**
6. **No destructive change without a recoverable path.**
7. **Do not rewrite working architecture** just to modernize it.
8. **Prefer repository evidence over assumption.** Probe, run, read — don't guess.

### Project-specific constraints

These are product commitments, enforced by tests. Treat them as constraints, not preferences.

9. **No fabricated market data.** If a provider is unavailable or a feature is not
   on the plan, the app says so. This is why there is no price-based stock
   screener: the Research screener uses SEC-reported figures only, with no prices
   and no valuation metrics.
10. **No predictions.** Indicators describe the past. Monte Carlo is labeled as
    dispersion under a stated assumption, never a forecast.
11. **No buy/sell verdicts.** Show evidence on both sides; surface conflicts.
12. **Every statistic states its basis** — window, frequency, observation count.
13. **Absent statistics are `null`, never `0`.** A missing Sharpe shown as 0.00
    reads as a real, bad value.
14. **Caveats are never hidden** behind a disclosure.
15. **Risky data is labeled, not silently filtered.** Sub-$5 movers are flagged;
    removing them would misreport the day's actual movers.
16. **Backtests must not be able to cheat.** One-bar execution lag, costs on by
    default, buy-and-hold benchmark, held-out slice, and every result reported —
    not just the winner. Each is enforced by a test; do not weaken them.

---

## Persistent state

| File | Holds |
|---|---|
| `STATE.md` | Current objective, what works, blockers, next actions, cold-start commands |
| `METRICS.json` | Measured values only, timestamped, each with the command that produced it |
| `LEARNINGS.md` | Durable lessons, append-only |
| `TENSIONS.md` | Unresolved problems and suspected issues. **Never emptied to look productive.** |
| `CHANGELOG.md` | Changes to this process (SM-n entries) |

Keep them lean. `ROADMAP.md` tracks product phases; `AUDIT.md` is the original
repository audit.

---

## Operating loop

**1. ORIENT** — Read state files. State in one line where we are and the single
most valuable next thing.

**2. PLAN** — Smallest increment yielding a verifiable result. Priority order:
correctness → security → reliability → objective → measurable improvement →
maintainability → performance → convenience. Reject scope creep.

**3. EXECUTE** — Change the repository. Small, coherent, reversible. Reuse
existing architecture.

**4. VERIFY** — **Stop dev servers and browsers first** (see CHANGELOG SM-2), then:

```bash
cd backend  && ruff check . && pytest        # current counts: STATE.md cold-start
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

Also: check for regressions, check nothing sensitive was staged, and confirm the
change actually satisfies the requirement. For UI work, look at it in a browser
in both themes at desktop and mobile widths.

**5. EVOLVE** — Only if there is real evidence of friction. One change at a time,
logged as an SM-n entry. Do not invent a process change to fill the slot.

**6. PERSIST** — Update state files so the next session starts cold.

---

## Quality gates

- [ ] It works, or the remaining limitation is documented.
- [ ] Tests and validation have actually been run.
- [ ] No known regression introduced.
- [ ] Security and publication constraints satisfied.
- [ ] Advances the objective, or is a named prerequisite.
- [ ] Reversible or recoverable.
- [ ] `STATE.md` reflects reality.
- [ ] Nothing fabricated.

A gate that cannot pass goes in `TENSIONS.md`. It is never marked passed anyway.

---

## Honesty contract

- "Done" means implemented **and verified**.
- Blocked means say so plainly and name the blocker.
- Flag guesses as guesses; distinguish repository facts from assumptions.
- If an instruction is technically flawed, say why and propose better — then
  defer to the operator's call. Do not silently comply with a bad design.
- Never fabricate test results, benchmarks, model performance, API behavior,
  security status, or completion status.

---

## Repository specifics

**Layout**
```
backend/app/analytics/   indicators, risk, interpretation — pure functions, no I/O
backend/app/services/    market data + provider integrations
backend/app/routes/      HTTP layer only
frontend/src/features/   quote, chart, analysis, education, market, search
frontend/src/lib/        api client, chart prep, formatting, export
frontend/src/styles/     design tokens (light + dark are both first-class)
```

**Conventions**
- All indicator math lives on the **backend**. MACD needs EMA, ADX needs ATR — a
  second copy in the frontend would drift. The analysis endpoint returns
  date-aligned series; the frontend only plots them.
- Indicator gaps serialize as `null`, never `0`.
- Wilder smoothing (`alpha = 1/period`) for RSI/ATR/ADX, not a standard EMA.
- US English throughout.
- All figures render with `font-variant-numeric: tabular-nums`.
- Meaning never rests on color alone — pair with a glyph.
- Design accent is brass, deliberately not the green/blue of typical finance UIs.

**Secrets**
- `.env` and `.env.*` are gitignored (`!.env.example` is the one exception).
- `personal.md` is gitignored and holds local setup notes.
- Provider keys must never reach logs — `providers/base.py` raises the httpx log
  level and a test asserts it.

**Data providers** — Verified against live free-tier keys 2026-08-05:
- Finnhub: quote, profile, company news, symbol search ✅
- FMP `/stable`: movers, sector performance, profile, quote ✅
- FMP: `company-screener`, `stock-list` → HTTP 402, **paid only**
- FMP `/api/v3` is retired; new keys get 403 "Legacy Endpoint"
- `yfinance` needs no key but is **not licensed for redistribution** (T-3)

---

## GitHub sync, ownership, and confidentiality

Standing instruction from the owner (2026-11-01). Applies to every session.

**Repository and identity.** `RoyGutta/stock-predictor`, branch `master`, remote
`origin`. Commit with the Git identity already configured on this machine; it
must match the author of the existing commits on `origin`. If it does not, stop
before committing and explain without printing the email. Never change Git config
to invent an identity, never add an AI co-author trailer, never create another
repository, change the remote, rewrite history, force-push, or delete branches.

**Push verified increments.** Each coherent, verified feature or fix is committed
and pushed rather than left local. Before each push:

1. Inspect the working tree; understand every change.
2. Run targeted tests, then the full gate in *Operating loop* step 4 (including
   `npm run build` and the browser suite for UI work).
3. Review the complete diff and every new or generated file.
4. Stage explicit paths only (`git add <file>…`, never `git add -A` / `git add .`);
   review staged and unstaged changes separately.
5. Scan the outgoing commits for secrets and private data (below).
6. Commit with a descriptive message, push, then confirm `origin/master` equals
   the local branch.

Compiling is not readiness. A failing test, unfinished feature, or open security
defect is reported as a blocker, never pushed as complete. If a push fails, keep
the work and report the exact error.

**Never commit or print** (this outranks pushing quickly): `.env`/`.env.*` files or
real variable values; API keys, tokens, passwords, cookies, signing keys,
certificates; personal balances, transactions, accounts, debts, holdings, exports
or backups; private notes (`personal.md`) or contact details; Claude Code local
state (`.claude/settings.local.json`, `.claude/worktrees/`), `.claude-flow/`,
`.swarm/`, `.hive-mind/`; databases, caches, logs with sensitive data, model
weights, private screenshots, browser profiles. Check `.gitignore` covers these
and that no intended source file is hidden by it. A placeholder in
`.env.example` is not a secret; a real value never goes in a tracked file. If a
real credential is found in history, stop the push and report it without
printing it; do not rewrite history or rotate credentials without authorization.

**Product guarantees still apply to every push:** synthetic public prices until
display rights exist; local Yahoo data stays private; SEC and Treasury figures
keep their source labels and dates; Money Manager data stays in the browser;
Finley never uses the owner's Claude or Anthropic credentials; missing values are
never zero; no guaranteed outcomes. Never weaken a test or safeguard to get green.

**Deployment** is separate from GitHub sync: only through the existing workflow,
only when authorized and the checks pass, verified independently. Never change
hosting credentials, billing, domains, production variables, repository
visibility, or permissions.

**Report after each increment:** what was built; which checks passed (with
counts); failures or skips; files committed; commit hash and message; whether the
push succeeded and local matches remote; whether production was deployed and
verified; confirmation that the outgoing changes were checked for secrets and
private data.

---

## Autonomy

Continue autonomously through implementation and verification. Do not stop after
one small file change when the larger task is clearly incomplete.

**Stop and ask** when a decision needs authorization, missing information,
credentials, external access, a product decision, or is potentially destructive.

---

## Response format

1. `CYCLE [n]` — one-line orientation
2. What was actually implemented
3. Verification performed, with results
4. Unresolved issues
5. Process change, if genuinely justified
6. Next highest-value action
