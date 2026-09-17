# CapEx Trend Tracker

Public capital-expenditure ledger: category mix, month-over-month change, CapEx-to-depreciation, and target comparisons. **First paint is fully baked HTML** — a static `curl -sL` of `index.html` already contains every required metric and all 18 month rows. No JavaScript, and no `Loading…` shell.

## Data

[`data/capex.json`](data/capex.json) is **sample data** (see `meta.sample` / `meta.note`): 18 months (April 2025–September 2026) of CapEx by category (`equipment`, `facilities`, `software` / IT, `vehicles`, `other`), monthly depreciation, and comparison targets.

## Formulas

All math lives in [`js/capex.js`](js/capex.js). Invalid, missing, or undefined results are **`null`**, never `NaN` or `Infinity`.

**Total CapEx** for month \(t\):

\[
T_t = \sum_c e_{t,c}
\]

Null or missing categories are skipped. If every category is missing, \(T_t\) is `null`. Explicit zeros are a valid total of `0`.

**MoM change**:

\[
\Delta_t = \frac{T_t - T_{t-1}}{T_{t-1}}
\]

`null` when \(T_t\) is null, \(T_{t-1}\) is null, or \(T_{t-1} = 0\) (zero CapEx).

**Category mix** (share of total):

\[
m_{t,c} = \frac{e_{t,c}}{T_t}
\]

Every share is `null` when \(T_t\) is null or `0`. A single-category month with \(T_t > 0\) is `1` for that category and `0` for the others.

**CapEx-to-depreciation**:

\[
r_t = \frac{T_t}{D_t}
\]

`null` when \(T_t\) is null, \(D_t\) is null, or \(D_t = 0\) (zero depreciation). Zero CapEx on positive depreciation is `0`.

**Target comparisons** for an actual \(A\) and goal \(G\):

\[
d = A - G, \qquad d\% = \frac{A - G}{G}
\]

`null` when \(A\) or \(G\) is null, or \(G = 0\). The UI treats monthly CapEx and the CapEx-to-depreciation ratio as “lower is better”: over target is a warning.

## How to re-render

```bash
node scripts/render-static.js
```

That reads `data/capex.json`, runs `js/capex.js`, and overwrites `index.html` with baked summary cards, category mix, spark bars, and the monthly table. Progressive enhancement in `js/app.js` (sortable columns, row select) is optional and must not replace first paint.

```bash
bash scripts/test.sh
```

Expect `Summary: N passed, 0 failed` and exit code 0. Checks cover zero CapEx, zero depreciation months, empty series, null inputs, single-category months, and static HTML first paint (including `curl -sL`).

## Suggested next improvements

- Replace the sample series with a live export (fixed-asset register or spreadsheet) and keep the same JSON shape.
- Add trailing-twelve-month CapEx and a rolling CapEx-to-depreciation band, still baked at render time.
- Split targets by month instead of a single monthly goal, so lumpy equipment and vehicle buys are compared fairly.
- Publish to GitHub Pages as-is (`.nojekyll` is already in the repo).
