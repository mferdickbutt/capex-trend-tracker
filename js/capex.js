/**
 * Pure CapEx analytics. Safe on zero CapEx, zero depreciation, empty series,
 * null inputs, and single-category months: never returns NaN or Infinity (null instead).
 *
 * Works in Node (CommonJS) and the browser (global `Capex`).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root && typeof root === "object") {
    root.Capex = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CATEGORIES = ["equipment", "facilities", "software", "vehicles", "other"];
  var CATEGORY_LABELS = {
    equipment: "Equipment",
    facilities: "Facilities",
    software: "Software / IT",
    vehicles: "Vehicles",
    other: "Other",
  };
  var MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function asNumber(value) {
    if (value == null || value === "") return null;
    if (typeof value === "boolean") return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) return null;
      var parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function finiteOrNull(value) {
    return isFiniteNumber(value) ? value : null;
  }

  /**
   * Sum of known CapEx categories.
   * Missing/null categories are skipped. All-missing → null.
   * Explicit zeros sum to 0 (zero CapEx is a valid total).
   */
  function totalCapex(capex) {
    if (capex == null || typeof capex !== "object" || Array.isArray(capex)) {
      return null;
    }
    var sum = 0;
    var seen = false;
    for (var i = 0; i < CATEGORIES.length; i++) {
      var key = CATEGORIES[i];
      if (!Object.prototype.hasOwnProperty.call(capex, key)) continue;
      if (capex[key] == null || capex[key] === "") continue;
      var n = asNumber(capex[key]);
      if (n == null) return null;
      sum += n;
      seen = true;
    }
    return seen ? finiteOrNull(sum) : null;
  }

  /**
   * Month-over-month change as a ratio: (current - previous) / previous.
   * Null when either side is null or previous is 0 (zero CapEx).
   */
  function monthOverMonth(current, previous) {
    var cur = asNumber(current);
    var prev = asNumber(previous);
    if (cur == null || prev == null || prev === 0) return null;
    return finiteOrNull((cur - prev) / prev);
  }

  /**
   * Share of total CapEx for each category (0–1).
   * When total is null or 0, every share is null.
   * Missing categories are 0 when total > 0.
   */
  function categoryMix(capex, total) {
    var mix = {};
    var t = arguments.length > 1 ? asNumber(total) : totalCapex(capex);
    var invalid =
      capex == null ||
      typeof capex !== "object" ||
      Array.isArray(capex) ||
      t == null ||
      t === 0;
    if (invalid) {
      for (var i = 0; i < CATEGORIES.length; i++) mix[CATEGORIES[i]] = null;
      return mix;
    }
    for (var j = 0; j < CATEGORIES.length; j++) {
      var key = CATEGORIES[j];
      if (!Object.prototype.hasOwnProperty.call(capex, key) || capex[key] == null || capex[key] === "") {
        mix[key] = 0;
        continue;
      }
      var n = asNumber(capex[key]);
      mix[key] = n == null ? null : finiteOrNull(n / t);
    }
    return mix;
  }

  /**
   * CapEx / depreciation. Null when depreciation is 0 or either input is null.
   * Zero CapEx with positive depreciation → 0.
   */
  function capexToDepreciation(total, depreciation) {
    var t = asNumber(total);
    var d = asNumber(depreciation);
    if (t == null || d == null || d === 0) return null;
    return finiteOrNull(t / d);
  }

  /**
   * Actual vs target: delta and delta as a share of target.
   * Null when actual/target is null or target is 0.
   */
  function compareToTarget(actual, target) {
    var a = asNumber(actual);
    var g = asNumber(target);
    if (a == null || g == null || g === 0) return null;
    var delta = a - g;
    var deltaPct = delta / g;
    if (!Number.isFinite(delta) || !Number.isFinite(deltaPct)) return null;
    return {
      actual: a,
      target: g,
      delta: delta,
      deltaPct: deltaPct,
      overTarget: a > g,
    };
  }

  function analyzeMonth(row, previousTotal, targets) {
    if (row == null || typeof row !== "object") return null;
    var total = totalCapex(row.capex);
    var depreciation = asNumber(row.depreciation);
    var mix = categoryMix(row.capex, total);
    var ratio = capexToDepreciation(total, depreciation);
    var mom = monthOverMonth(total, previousTotal);
    var capexTarget = null;
    var ratioTarget = null;
    var mixTargets = null;
    if (targets && typeof targets === "object") {
      if (targets.monthlyCapex != null) {
        capexTarget = compareToTarget(total, targets.monthlyCapex);
      }
      if (targets.capexToDepreciation != null) {
        ratioTarget = compareToTarget(ratio, targets.capexToDepreciation);
      }
      if (targets.categoryMix && typeof targets.categoryMix === "object") {
        mixTargets = {};
        for (var i = 0; i < CATEGORIES.length; i++) {
          var key = CATEGORIES[i];
          mixTargets[key] = compareToTarget(mix[key], targets.categoryMix[key]);
        }
      }
    }
    return {
      month: typeof row.month === "string" ? row.month : null,
      capex: row.capex && typeof row.capex === "object" ? row.capex : null,
      total: total,
      depreciation: depreciation,
      mix: mix,
      capexToDepreciation: ratio,
      mom: mom,
      vsCapexTarget: capexTarget,
      vsRatioTarget: ratioTarget,
      vsMixTarget: mixTargets,
    };
  }

  /**
   * Analyze a full data document `{ meta, targets, months }`.
   * Empty/null series → `{ months: [], latest: null, mom: null }`.
   */
  function analyzeSeries(data) {
    var empty = {
      months: [],
      latest: null,
      previous: null,
      mom: null,
      targets: null,
      currency: "USD",
      categories: CATEGORIES.slice(),
      meta: null,
    };
    if (data == null || typeof data !== "object") return empty;
    var targets = data.targets && typeof data.targets === "object" ? data.targets : null;
    var rows = Array.isArray(data.months) ? data.months.filter(Boolean) : [];
    var sorted = rows.slice().sort(function (a, b) {
      return String((a && a.month) || "").localeCompare(String((b && b.month) || ""));
    });
    var months = [];
    var prevTotal = null;
    for (var i = 0; i < sorted.length; i++) {
      var analyzed = analyzeMonth(sorted[i], prevTotal, targets);
      if (analyzed) {
        months.push(analyzed);
        prevTotal = analyzed.total;
      }
    }
    var latest = months.length ? months[months.length - 1] : null;
    var previous = months.length > 1 ? months[months.length - 2] : null;
    return {
      months: months,
      latest: latest,
      previous: previous,
      mom: latest ? latest.mom : null,
      targets: targets,
      currency: (data.meta && data.meta.currency) || "USD",
      categories: CATEGORIES.slice(),
      meta: data.meta || null,
    };
  }

  function monthLabel(iso) {
    if (iso == null || typeof iso !== "string") return "—";
    var parts = iso.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    if (!year || month < 1 || month > 12) return iso;
    return MONTH_NAMES[month - 1] + " " + year;
  }

  function formatMoney(value) {
    if (!isFiniteNumber(value)) return "—";
    var abs = Math.abs(value);
    var formatted = abs.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    return value < 0 ? "-" + formatted : formatted;
  }

  function formatPercent(ratio, signed, digits) {
    if (!isFiniteNumber(ratio)) return "—";
    var places = isFiniteNumber(digits) ? digits : 1;
    var pct = ratio * 100;
    var body = pct.toFixed(places) + "%";
    if (signed && pct > 0) return "+" + body;
    return body;
  }

  function formatMultiple(ratio, digits) {
    if (!isFiniteNumber(ratio)) return "—";
    var places = isFiniteNumber(digits) ? digits : 2;
    return ratio.toFixed(places) + "×";
  }

  function formatRatio(ratio) {
    return formatMultiple(ratio, 2);
  }

  function categoryLabel(key) {
    if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
    if (!key) return "—";
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  return {
    CATEGORIES: CATEGORIES,
    CATEGORY_LABELS: CATEGORY_LABELS,
    isFiniteNumber: isFiniteNumber,
    asNumber: asNumber,
    totalCapex: totalCapex,
    monthOverMonth: monthOverMonth,
    categoryMix: categoryMix,
    capexToDepreciation: capexToDepreciation,
    compareToTarget: compareToTarget,
    analyzeMonth: analyzeMonth,
    analyzeSeries: analyzeSeries,
    monthLabel: monthLabel,
    formatMoney: formatMoney,
    formatPercent: formatPercent,
    formatMultiple: formatMultiple,
    formatRatio: formatRatio,
    categoryLabel: categoryLabel,
  };
});
