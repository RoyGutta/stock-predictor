# Phase 0 — Repository Audit

**Date:** 2026-08-04
**Repo:** `Stock Predictor`
**Auditor:** automated full-file inspection (every non-`node_modules` file read)

---

## 1. Executive summary

The repository contains **~450 lines of hand-written code total**. It is a working
single-file prototype, not a partially-built platform.

The headline finding: **the project is named "Stock Predictor" but contains no
prediction model, and 11 of its 14 backend Python files are completely empty (0 bytes).**
The backend directory tree implies an architecture (models, routes, ml, database) that
has never been written.

A second finding of equal practical urgency: **the repository has zero git commits, an
empty `.gitignore`, and 334 MB of `node_modules` across three directories.** In its
current state a `git add -A` would commit all of it.

Nothing here is broken or bad — it is an early prototype that works. But it should be
scoped as a greenfield build with a usable reference prototype, not as a refactor.

---

## 2. Architecture overview

### Actual architecture (what exists)

```
Browser (React 19 SPA, Vite)
    │
    │  fetch("http://127.0.0.1:8001/?ticker=X&range=1M")   ← hardcoded URL
    ▼
FastAPI, single route "/" (62 lines, backend/app/main.py)
    │
    ▼
yfinance  →  Yahoo Finance (unofficial, unauthenticated, rate-limited)
```

That is the entire system. One endpoint, one component, one data source.

- **No database.** `database.py` is empty; nothing is persisted. Search history lives in
  React state and dies on refresh.
- **No authentication.** `routes/auth.py` is empty.
- **No ML / prediction.** `ml/predictor.py` and `ml/risk_analysis.py` are empty.
  `scikit-learn` is declared in `requirements.txt` but never imported anywhere.
- **No state management, routing, or component library.** One 342-line `App.tsx`.
- **No Tailwind.** (Worth noting since the brief refers to avoiding a "generic Tailwind
  template" appearance — there is no CSS framework at all; all styling is inline `style={{}}`.)

### Technical indicators — the one genuinely solid piece

`App.tsx` contains correct, pure, client-side implementations of:

- SMA (`chartData` memo, line 169)
- EMA with SMA seeding (`calculateEMA`, line 125) — correctly seeds from SMA at
  `period-1` rather than starting from the first price, which is the textbook-correct approach
- Bollinger Bands, population standard deviation, 2σ (`calculateBollinger`, line 142)
- LTTB-style downsampling guard at 1000 points (`downsampleIfNeeded`, line 154)

These are worth keeping and porting, not rewriting. They are the strongest code in the repo.

---

## 3. Folder structure

```
Stock Predictor/
├── .gitignore                    ⚠️  0 bytes — EMPTY
├── readme.md                     ⚠️  0 bytes — EMPTY
├── package.json                  ⚠️  third React app, conflicts with frontend/
├── package-lock.json
├── node_modules/                 ⚠️  98 MB, untracked, would be committed
├── data/                         ⚠️  empty directory
│
├── backend/
│   ├── requirements.txt          5 unpinned deps
│   └── app/
│       ├── main.py               ✅ 62 lines — the only backend code that exists
│       ├── database.py           ⚠️  0 bytes
│       ├── ml/
│       │   ├── predictor.py      ⚠️  0 bytes
│       │   └── risk_analysis.py  ⚠️  0 bytes
│       ├── models/
│       │   ├── users.py          ⚠️  0 bytes
│       │   ├── stock.py          ⚠️  0 bytes
│       │   └── portfolio.py      ⚠️  0 bytes
│       └── routes/
│           ├── auth.py           ⚠️  0 bytes
│           ├── stocks.py         ⚠️  0 bytes
│           └── portfolio.py      ⚠️  0 bytes
│
├── frontend/                     ✅ the real app
│   ├── src/App.tsx               342 lines — entire application
│   ├── src/main.tsx              10 lines
│   ├── src/App.css               42 lines (Vite default, unused)
│   ├── src/index.css             68 lines (Vite default, mostly unused)
│   ├── node_modules/             138 MB
│   └── [vite/ts/eslint configs]  ✅ sane
│
└── test-app/                     ⚠️  UNTOUCHED VITE BOILERPLATE + 98 MB node_modules
```

**Missing entirely:** no `__init__.py` files (the `backend/app` package tree is not
importable as a package), no `.env` / `.env.example`, no tests, no CI, no Dockerfile,
no `LICENSE`, no `CONTRIBUTING.md`, no API docs.

---

## 4. Dependency analysis

### Backend — `backend/requirements.txt`

| Package | Status |
|---|---|
| `fastapi` | ✅ used |
| `uvicorn` | ✅ used (as server) |
| `yfinance` | ✅ used |
| `pandas` | ⚠️ used only transitively via yfinance; never imported directly |
| `scikit-learn` | ❌ **never imported anywhere.** Dead ~100 MB dependency (pulls scipy/numpy) |

**All 5 are unpinned** — no version constraints at all. A fresh install six months from
now gets different, possibly incompatible, versions. `yfinance` in particular makes
breaking changes frequently.

### Frontend — `frontend/package.json`

| Package | Status |
|---|---|
| `react` / `react-dom` ^19.1.1 | ✅ used |
| `recharts` ^3.3.0 | ✅ used |
| `html2canvas` ^1.4.1 | ⚠️ used for PNG export, but **unmaintained** (last release 2022) and known to render `oklch()`/modern CSS colors incorrectly. Should move to `html-to-image` or `satori`. |

Dev dependencies (eslint 9, typescript-eslint 8, vite 7) are current and correctly configured.

### Three competing `package.json` files

| Location | React | Purpose |
|---|---|---|
| `/package.json` | **18.2.0** | orphan — no `src/`, no `index.html`. Unusable. |
| `/frontend/package.json` | **19.1.1** | the real app |
| `/test-app/package.json` | 19.1.1 | boilerplate |

The root `package.json` declares React 18 while the actual app uses React 19. It has its
own 98 MB `node_modules` and cannot run — there is no entry point at the root. This is
pure confusion and 98 MB of waste.

---

## 5. Unused files & dead code

| Item | Size | Verdict |
|---|---|---|
| `test-app/` | 98 MB | Untouched `npm create vite` output. Zero project code. **Delete.** |
| `/package.json` + `/package-lock.json` + `/node_modules` | 98 MB | Orphan third app. **Delete.** |
| 11 empty `.py` files | 0 B | Aspirational scaffolding. Implement or delete. |
| `data/` | 0 B | Empty directory (git won't track it anyway). |
| `frontend/src/App.css` | 42 lines | Vite default. Only `.logo` / `.card` rules — no element in `App.tsx` uses these classes. **Dead.** |
| `frontend/src/index.css` | 68 lines | Vite default. Overridden by inline styles. **Mostly dead.** |
| `frontend/src/assets/react.svg`, `public/vite.svg` | — | Unreferenced in `App.tsx`. **Dead.** |
| `scikit-learn` | ~100 MB installed | Never imported. **Dead.** |

**Removing `test-app/` and the root app reclaims 196 MB and eliminates the ambiguity of
"which app do I run?"**

---

## 6. Security issues

Ranked by severity.

### 🔴 CRITICAL — repository is not safe to publish as-is

1. **`.gitignore` is empty (0 bytes)** while 334 MB of `node_modules` sits in the tree.
   With zero commits made, the first `git add -A` commits everything. Also unignored:
   `__pycache__/`, `.venv/`, `.DS_Store`, `dist/`, and any future `.env`.

2. **No `.env` / secrets management exists.** Nothing is leaked *yet* — because there are
   no secrets yet. But there is no mechanism to keep it that way once an API key is added.

### 🟠 HIGH

3. **`CORSMiddleware(allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])`**
   — `main.py:8-13`. The code comment even flags it ("Restrict to ... later"). Any website
   on the internet can call this API from a visitor's browser. Must be an env-driven allowlist.

4. **Unvalidated `ticker` passed straight to a third-party network call** — `main.py:16-18`.
   No length cap, no charset validation, no allowlist. A caller can pass arbitrary strings
   to yfinance. Not RCE, but it is an unbounded outbound-request primitive (SSRF-adjacent)
   and a trivial way to burn the shared Yahoo rate limit.

5. **Raw exception text returned to the client** — `main.py:62-63`,
   `return {"error": str(e)}`. Leaks stack-trace-adjacent internals, file paths, and library
   versions to any caller. Should log server-side, return an opaque error.

6. **No rate limiting anywhere.** A single client can trivially exhaust the Yahoo Finance
   quota and take the app down for everyone.

### 🟡 MEDIUM

7. **HTTP errors always return `200 OK`** with `{"error": ...}` in the body. Breaks every
   HTTP-aware client, cache, and monitoring tool. Should use proper 4xx/5xx status codes.

8. **No security headers**, no HTTPS enforcement, no request size limits.

---

## 7. API issues

| Issue | Location | Detail |
|---|---|---|
| Entire API is mounted on `/` | `main.py:15` | No `/api/v1` prefix. Impossible to version or add a health check cleanly. |
| Shadows Python builtin `range` | `main.py:16` | Parameter named `range` shadows the builtin inside the function. |
| Only 3 ranges supported | `main.py:25` | `1D`, `1M`, `1Y` — and `1D` requests `period="1d"` at `interval="1d"`, which returns **exactly one data point**, so the 1D chart is a single dot with a 0% change. **This is a live bug.** |
| `stock.info` is very expensive | `main.py:21` | Fetches a large scraped payload on *every* request just to read `longName`. This is the single slowest call in the app and the most rate-limit-prone. |
| No caching | — | Identical repeat requests re-hit Yahoo every time. |
| No pagination / no compression | — | Full history serialized as JSON on every call. |
| Typo in variable name | `main.py:22` | `comapny_name` (sic). Cosmetic but user-facing code. |
| No OpenAPI metadata | `main.py:5` | `FastAPI()` with no title/version/description. Auto-docs are unlabeled. |
| No `/health` endpoint | — | Nothing to point a load balancer or uptime check at. |

---

## 8. Performance issues

**Backend**
- `stock.info` on every request (see above) — dominant latency cost, often 1–3 s.
- Synchronous blocking I/O inside an `async`-capable framework. `yf.Ticker()` blocks the
  event loop; under concurrency the server serializes all requests.
- No response caching, no ETag, no gzip.

**Frontend**
- `chartData` recomputes SMA + EMA + Bollinger over the full series on every change to
  `maPeriod`, `showEMA`, or `showBollinger`. Memoized correctly, but the indicator functions
  each allocate a new array of new objects — three full passes, three full copies.
- Recharts re-renders all 5 series on any state change, including unrelated ones like
  `bgColor` or `priceColor`.
- The `downsampleIfNeeded` guard is good, but it is applied *after* all indicators are
  computed on the full dataset, so it saves render time but not compute time.
- No code splitting, no lazy loading, no route-level chunking (single component, so nothing
  to split yet — but Recharts is ~350 KB and is loaded eagerly).

---

## 9. Scalability issues

- **Stateless but single-source.** Every user request proxies to Yahoo Finance with no cache
  layer. Yahoo's undocumented rate limit becomes a hard ceiling on total users — roughly
  "a few concurrent users" before throttling.
- **No persistence layer**, so no user accounts, portfolios, watchlists, or alerts are
  possible without building it from zero. Every feature in Phases 14–16 depends on this.
- **Blocking I/O** (above) caps concurrency at effectively 1 request at a time per worker.
- **No background jobs / scheduler**, so nothing can pre-warm caches or run alerts.
- **`yfinance` is an unofficial scraper** and is explicitly not licensed for commercial or
  redistributed use. This is a *legal* scalability ceiling, not just a technical one, and it
  matters for a public deployment.

---

## 10. UI consistency issues

- **100% inline styles.** No design tokens, no theme object, no CSS variables. Every color,
  space, and radius is a magic value repeated at each use site.
- **Inconsistent color semantics.** The main panel uses `lightgreen` / `#ff8b94` for
  gain/loss; the history panel uses `green` / `red` for the same meaning. Two palettes for
  one concept.
- **Arbitrary values.** Border radii of `6`, `8`, and `10` appear with no system.
  A stray `#940000ff` (8-digit hex) borders the history cards.
- **"Dark mode" is partial.** `darkMode` controls the page background and text, but the
  chart's `gridColor`/`bgColor` are independent user-set colors that don't follow the theme,
  so toggling to light mode leaves a dark chart.
- **Five color pickers in the main toolbar** (price/MA/volume/grid/background) put niche
  customization at the same visual priority as the ticker input.
- **No loading skeletons, no empty states, no error UI.** A failed fetch logs to console and
  silently renders nothing — the user sees no feedback at all.
- **Not responsive.** Fixed `display: flex` with `flex: 3` / `flex: 1` and `padding: 2rem`.
  Below ~900 px the layout collapses unusably. No media queries anywhere.

---

## 11. Accessibility issues

- **No landmarks.** No `<main>`, `<nav>`, `<header>`, or `<aside>`. The entire page is nested `<div>`s.
- **Color-only information.** Gain/loss is conveyed purely by red/green text. Fails
  WCAG 1.4.1 (Use of Color); invisible to red-green colorblind users (~8% of men).
- **Contrast failures.** `lightgreen` (`#90EE90`) on `#111` is fine, but `green` (`#008000`)
  on white in the history panel is ~5.1:1 — passes AA for body text but fails for the small
  bold text it is used on in some states. `#8884d8` chart strokes on `#0b0f14` are ~4.0:1, below AA.
- **No focus indicators.** Buttons use `border: none` with no `:focus-visible` styling.
  Keyboard navigation is invisible.
- **Unlabeled controls.** Color inputs have adjacent text but no `htmlFor`/`id` association.
  The ticker input has a `placeholder` but no `<label>` — screen readers announce it as
  an unlabeled textbox once typing starts.
- **No live region.** Fetch results appear with no `aria-live` announcement.
- **Chart is entirely inaccessible.** Recharts renders SVG with no `role="img"`, no
  `aria-label`, no text alternative, and no data table fallback.
- **Toggle buttons are not toggles.** Range buttons (1D/1M/1Y) convey selection by color
  and font-weight only — no `aria-pressed`.

---

## 12. GitHub readiness report

| Requirement | Status |
|---|---|
| `README.md` | ❌ **0 bytes, empty** |
| `LICENSE` | ❌ missing |
| `.gitignore` | ❌ **0 bytes, empty** |
| `.env.example` | ❌ missing |
| `CONTRIBUTING.md` | ❌ missing |
| `CODE_OF_CONDUCT.md` | ❌ missing |
| Any git commit | ❌ **zero commits on `master`** |
| CI workflow | ❌ missing |
| Tests | ❌ none |
| Backend lint/format config | ❌ none (no ruff/black) |
| Frontend lint config | ✅ eslint 9 flat config, correct |
| TypeScript strict mode | ✅ **already enabled** (`strict`, `noUnusedLocals`, `noUnusedParameters`) |
| Frontend typechecks | ✅ **passes clean** |
| Financial disclaimer | ❌ missing — **required** before public release |
| Secrets committed | ✅ none (nothing committed at all) |

**Verdict: NOT ready to publish.** The blocking items are the empty `.gitignore` (334 MB of
`node_modules` would land in the first commit) and the absent README/LICENSE/disclaimer.

---

## 13. Prioritized remediation plan

**P0 — must happen before the first commit**
1. Write a real `.gitignore` (node_modules, `__pycache__`, `.venv`, `.env`, `dist`, `.DS_Store`).
2. Make the first commit.
3. Add `LICENSE` + educational/financial disclaimer.

**P1 — correctness & security**
4. Fix the `1D` range bug (needs `interval="5m"`, not `"1d"`).
5. Env-driven CORS allowlist; stop returning `str(e)`; use real HTTP status codes.
6. Validate/sanitize the `ticker` input; add rate limiting.
7. Pin all Python dependencies; drop unused `scikit-learn`.

**P2 — remove waste**
8. Delete `test-app/` and the root app (196 MB, zero value).
9. Delete or implement the 11 empty Python files.

**P3 — foundation for everything else**
10. Add a caching layer (this is the single highest-leverage change for both performance
    and scalability — it removes the Yahoo rate limit as a hard user ceiling).
11. Move to async / threadpool-offloaded data fetching.
12. Introduce a persistence layer — every portfolio/watchlist/paper-trading feature depends on it.
13. Extract the indicator math out of `App.tsx` into a tested, shared module.

---

## 14. Note on scope

The brief describes 20 phases including live streaming market data, a full stock screener,
paper trading with leaderboards, news aggregation with summarization, Monte Carlo risk
simulation, and a full E2E test suite.

Measured against what exists (~450 lines, one endpoint, one component, no database), this is
a **greenfield build with a working reference prototype**, not a refactor of an existing
platform. Several phases also carry hard external dependencies that cannot be resolved from
inside the repo:

- **Phases 7 / 11 / 12 / 17** (live data, screener, search, news) require a commercial market
  data provider. `yfinance` cannot legally or technically serve them — it is an unofficial
  scraper with no fundamentals, no screener, no news API, and no redistribution rights.
- **Phase 9** (AI explanations) requires an LLM API key.
- **Phases 14 / 15 / 16** (portfolios, watchlists, paper trading) require a database and auth,
  which do not exist yet.

The stated constraint — *no fabricated market data, no fake predictions* — is the right call
and is fully compatible with this plan. It does mean features cannot be "stubbed with demo
data" to appear complete; each one ships only when it has a real data source behind it.

Recommended sequencing is the P0→P3 list above, which is ordered by leverage rather than by
phase number: the security and caching work unblocks everything downstream.
