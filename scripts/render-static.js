#!/usr/bin/env node
/**
 * Bake CapEx summary metrics and the monthly table into index.html.
 * First paint does not require JavaScript.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const Capex = require("../js/capex.js");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "capex.json");
const OUT_PATH = path.join(ROOT, "index.html");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(value) {
  return value == null || !Number.isFinite(Number(value)) ? "" : String(value);
}

function toneClass(value, invert) {
  if (!Capex.isFiniteNumber(value) || value === 0) return "";
  const upIsBad = invert !== false;
  if (value > 0) return upIsBad ? "up" : "down good";
  return upIsBad ? "down good" : "up";
}

function targetCopy(comparison, unit) {
  if (!comparison) return "No target comparison (missing actual or target).";
  const verb = comparison.overTarget ? "over" : "under";
  const cls = comparison.overTarget ? "warn" : "good";
  const relative = Capex.formatPercent(Math.abs(comparison.deltaPct), false, 1);
  if (unit === "money") {
    return (
      '<span class="' +
      cls +
      '">' +
      verb +
      " target by " +
      Capex.formatMoney(Math.abs(comparison.delta)) +
      " (" +
      relative +
      ")</span>"
    );
  }
  if (unit === "multiple") {
    return (
      '<span class="' +
      cls +
      '">' +
      verb +
      " target by " +
      Capex.formatMultiple(Math.abs(comparison.delta), 2) +
      " (" +
      relative +
      " relative)</span>"
    );
  }
  return (
    '<span class="' +
    cls +
    '">' +
    verb +
    " target by " +
    Capex.formatPercent(Math.abs(comparison.delta), false, 1) +
    " pts (" +
    relative +
    " relative)</span>"
  );
}

function pill(comparison) {
  if (!comparison) return '<span class="pill">—</span>';
  const cls = comparison.overTarget ? "over" : "under";
  const label = comparison.overTarget ? "Over" : "Under";
  return (
    '<span class="pill ' +
    cls +
    '">' +
    label +
    " " +
    Capex.formatPercent(Math.abs(comparison.deltaPct), false, 1) +
    "</span>"
  );
}

function mixRows(latest) {
  return Capex.CATEGORIES.map(function (key) {
    if (!latest) {
      return (
        '<div class="mix-row"><div>' +
        escapeHtml(Capex.categoryLabel(key)) +
        '</div><div class="mix-bar"><span style="width:0%"></span></div><div>—</div><div class="sub">—</div></div>'
      );
    }
    const share = latest.mix[key];
    const width = Capex.isFiniteNumber(share) ? Math.max(0, Math.min(100, share * 100)).toFixed(1) : "0";
    const vs = latest.vsMixTarget ? latest.vsMixTarget[key] : null;
    const vsText = vs
      ? (vs.overTarget ? "over" : "under") + " mix target " + Capex.formatPercent(Math.abs(vs.delta), false, 1) + " pts"
      : "no mix target";
    return (
      '<div class="mix-row"><div>' +
      escapeHtml(Capex.categoryLabel(key)) +
      '</div><div class="mix-bar" title="' +
      escapeHtml(Capex.formatPercent(share, false, 1)) +
      '"><span style="width:' +
      width +
      '%"></span></div><div>' +
      Capex.formatPercent(share, false, 1) +
      '</div><div class="sub">' +
      escapeHtml(vsText) +
      "</div></div>"
    );
  }).join("");
}

function sparkBars(months) {
  const totals = months.map(function (row) {
    return Capex.isFiniteNumber(row.total) ? row.total : 0;
  });
  const max = totals.reduce(function (acc, n) {
    return n > acc ? n : acc;
  }, 0);
  return months
    .map(function (row, index) {
      const height = max > 0 && Capex.isFiniteNumber(row.total) ? (row.total / max) * 100 : 0;
      const latest = index === months.length - 1 ? " is-latest" : "";
      return (
        '<div class="bar' +
        latest +
        '" style="height:' +
        height.toFixed(1) +
        '%" title="' +
        escapeHtml(Capex.monthLabel(row.month) + " " + Capex.formatMoney(row.total)) +
        '"></div>'
      );
    })
    .join("");
}

function monthRows(months) {
  return months
    .map(function (row) {
      const capex = row.capex || {};
      const cells = Capex.CATEGORIES.map(function (key) {
        const n = Capex.asNumber(capex[key]);
        return (
          '<td data-key="' +
          key +
          '" data-value="' +
          attr(n) +
          '">' +
          Capex.formatMoney(n) +
          "</td>"
        );
      }).join("");
      return (
        '<tr data-month="' +
        escapeHtml(row.month || "") +
        '" data-label="' +
        escapeHtml(Capex.monthLabel(row.month)) +
        '" data-total="' +
        escapeHtml(Capex.formatMoney(row.total)) +
        '">' +
        '<td data-key="month" data-value="' +
        escapeHtml(row.month || "") +
        '">' +
        escapeHtml(Capex.monthLabel(row.month)) +
        "</td>" +
        cells +
        '<td data-key="total" data-value="' +
        attr(row.total) +
        '">' +
        Capex.formatMoney(row.total) +
        "</td>" +
        '<td data-key="depreciation" data-value="' +
        attr(row.depreciation) +
        '">' +
        Capex.formatMoney(row.depreciation) +
        "</td>" +
        '<td data-key="ratio" data-value="' +
        attr(row.capexToDepreciation) +
        '">' +
        Capex.formatRatio(row.capexToDepreciation) +
        "</td>" +
        '<td data-key="mom" data-value="' +
        attr(row.mom) +
        '">' +
        Capex.formatPercent(row.mom, true, 1) +
        "</td>" +
        '<td data-key="target">' +
        pill(row.vsCapexTarget) +
        "</td>" +
        "</tr>"
      );
    })
    .join("\n");
}

function render(data) {
  const series = Capex.analyzeSeries(data);
  const latest = series.latest;
  const coverage = data.meta && data.meta.coverage ? data.meta.coverage : "";
  const monthCount = series.months.length;
  const latestLabel = latest ? Capex.monthLabel(latest.month) : "—";
  const totalText = latest ? Capex.formatMoney(latest.total) : "—";
  const momText = latest ? Capex.formatPercent(latest.mom, true, 1) : "—";
  const ratioText = latest ? Capex.formatRatio(latest.capexToDepreciation) : "—";
  const momHint =
    latest && series.previous
      ? "vs " + Capex.monthLabel(series.previous.month) + " (" + Capex.formatMoney(series.previous.total) + ")"
      : "MoM change needs a prior month with non-zero CapEx";
  const targetCapex = series.targets ? Capex.formatMoney(series.targets.monthlyCapex) : "—";
  const targetRatio = series.targets ? Capex.formatMultiple(series.targets.capexToDepreciation, 2) : "—";
  const sparkCols = Math.max(monthCount, 1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CapEx Trend Tracker</title>
  <meta name="description" content="Capital expenditure trend tracker with category mix, MoM change, CapEx-to-depreciation, and target comparisons. First paint is fully baked HTML.">
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="kicker">Capital expenditure ledger</div>
      <h1>CapEx Trend Tracker</h1>
      <p>
        ${monthCount} months of sample capital expenditure (${escapeHtml(coverage)}).
        Summary metrics and the monthly table below are baked into this HTML so a static
        <code>curl -sL</code> first paint shows Total CapEx, MoM change, category mix, CapEx-to-depreciation, and every month row with no JavaScript placeholder.
      </p>
    </header>

    <section class="metrics" aria-label="Summary metrics">
      <article class="card" id="metric-total-capex">
        <h2>Total CapEx</h2>
        <p class="value">${totalText}</p>
        <p class="hint">${escapeHtml(latestLabel)}</p>
      </article>
      <article class="card" id="metric-mom">
        <h2>MoM change</h2>
        <p class="value ${toneClass(latest && latest.mom)}">${momText}</p>
        <p class="hint">${escapeHtml(momHint)}</p>
      </article>
      <article class="card" id="metric-capex-to-depreciation">
        <h2>CapEx-to-depreciation</h2>
        <p class="value">${ratioText}</p>
        <p class="hint">CapEx as a multiple of monthly depreciation</p>
      </article>
      <article class="card" id="metric-targets">
        <h2>Target comparisons</h2>
        <p class="sub">CapEx target ${targetCapex}: ${latest ? targetCopy(latest.vsCapexTarget, "money") : "—"}</p>
        <p class="sub">CapEx-to-depreciation target ${targetRatio}: ${latest ? targetCopy(latest.vsRatioTarget, "multiple") : "—"}</p>
      </article>
    </section>

    <section class="mix" id="category-mix" aria-label="Category mix">
      <h2>Category mix</h2>
      <p class="hint">Percent of total by category for ${escapeHtml(latestLabel)}.</p>
      <div class="mix-grid">
        ${mixRows(latest)}
      </div>
    </section>

    <section class="trend" aria-label="CapEx sparkline">
      <h2>Monthly CapEx</h2>
      <div class="spark" style="grid-template-columns: repeat(${sparkCols}, 1fr)">${sparkBars(series.months)}</div>
    </section>

    <section aria-label="Monthly table">
      <h2>Monthly table</h2>
      <p class="hint">Click a column header to sort after JavaScript loads. Rows and values are already in the markup.</p>
      <p id="selected-month"></p>
      <div class="table-wrap">
        <table id="monthly-table">
          <thead>
            <tr>
              <th data-sort="month" data-type="string">Month</th>
              <th data-sort="equipment" data-type="number">Equipment</th>
              <th data-sort="facilities" data-type="number">Facilities</th>
              <th data-sort="software" data-type="number">Software / IT</th>
              <th data-sort="vehicles" data-type="number">Vehicles</th>
              <th data-sort="other" data-type="number">Other</th>
              <th data-sort="total" data-type="number">Total CapEx</th>
              <th data-sort="depreciation" data-type="number">Depreciation</th>
              <th data-sort="ratio" data-type="number">CapEx-to-depreciation</th>
              <th data-sort="mom" data-type="number">MoM</th>
              <th>vs CapEx target</th>
            </tr>
          </thead>
          <tbody>
${monthRows(series.months)}
          </tbody>
        </table>
      </div>
    </section>

    <footer>
      <p>Sample source data: <a href="data/capex.json"><code>data/capex.json</code></a>. Re-render with <code>node scripts/render-static.js</code>.</p>
    </footer>
  </div>
  <script src="js/capex.js" defer></script>
  <script src="js/app.js" defer></script>
</body>
</html>
`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const html = render(data);
  fs.writeFileSync(OUT_PATH, html);
  const series = Capex.analyzeSeries(data);
  process.stdout.write(
    "Wrote " +
      path.relative(ROOT, OUT_PATH) +
      " with " +
      series.months.length +
      " month rows; latest total " +
      (series.latest ? Capex.formatMoney(series.latest.total) : "—") +
      "\n"
  );
}

main();
