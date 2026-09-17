#!/usr/bin/env bash
# CapEx tracker checks: pure math edge cases + static first-paint HTML.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is required"
  echo "Summary: 0 passed, 1 failed"
  exit 1
fi

MATH_OUT="$(node << 'NODE'
const fs = require("fs");
const Capex = require("./js/capex.js");

function isPoison(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.some(isPoison);
    return Object.keys(value).some((k) => isPoison(value[k]));
  }
  return false;
}

function check(name, cond) {
  process.stdout.write((cond ? "PASS: " : "FAIL: ") + name + "\n");
}

check("null input totalCapex returns null", Capex.totalCapex(null) === null);
check("empty object totalCapex returns null", Capex.totalCapex({}) === null);
check("zero CapEx total is 0 not null", Capex.totalCapex({
  equipment: 0, facilities: 0, software: 0, vehicles: 0, other: 0
}) === 0);

const zeroMix = Capex.categoryMix({
  equipment: 0, facilities: 0, software: 0, vehicles: 0, other: 0
});
check("zero CapEx category mix is null shares", Object.values(zeroMix).every((v) => v === null));

check("MoM with previous zero CapEx returns null", Capex.monthOverMonth(100, 0) === null);
check("MoM with null inputs returns null", Capex.monthOverMonth(null, null) === null);
check("MoM 110 vs 100 is 0.1", Capex.monthOverMonth(110, 100) === 0.1);

check("CapEx-to-depreciation with zero depreciation returns null", Capex.capexToDepreciation(80, 0) === null);
check("CapEx-to-depreciation null inputs return null", Capex.capexToDepreciation(null, null) === null);
check("zero CapEx vs positive depreciation is 0", Capex.capexToDepreciation(0, 500) === 0);

const single = Capex.categoryMix({ equipment: 2500 });
check("single-category month mix is 100% equipment", single.equipment === 1);
check("single-category remaining categories are 0", single.facilities === 0 && single.software === 0 && single.vehicles === 0 && single.other === 0);
check("single-category totalCapex equals the one category", Capex.totalCapex({ equipment: 2500 }) === 2500);

const empty = Capex.analyzeSeries({ months: [] });
check("empty series latest is null", empty.latest === null && empty.mom === null && Array.isArray(empty.months) && empty.months.length === 0);
check("null series analyzeSeries returns empty months", Capex.analyzeSeries(null).months.length === 0);

check("compareToTarget with zero target returns null", Capex.compareToTarget(10, 0) === null);
check("compareToTarget 90 vs 100 is under by 10%", Capex.compareToTarget(90, 100).overTarget === false && Capex.compareToTarget(90, 100).deltaPct === -0.1);

const infGuard = Capex.analyzeSeries({
  targets: { monthlyCapex: 0, capexToDepreciation: 0 },
  months: [
    { month: "2026-01", depreciation: 0, capex: { equipment: 0, facilities: 0, software: 0, vehicles: 0, other: 0 } },
    { month: "2026-02", depreciation: null, capex: null },
    { month: "2026-03", depreciation: 1000, capex: { equipment: 1000 } }
  ]
});
check("zero/empty/null series never yields NaN or Infinity", !isPoison(infGuard));
check("zero depreciation month ratio is null", infGuard.months[0] && infGuard.months[0].capexToDepreciation === null);
check("zero CapEx month mix shares are null", infGuard.months[0] && Object.values(infGuard.months[0].mix).every((v) => v === null));
check("single-category month in mixed series has 100% mix", infGuard.months[2] && infGuard.months[2].mix.equipment === 1 && infGuard.months[2].total === 1000);

const sample = JSON.parse(fs.readFileSync("./data/capex.json", "utf8"));
const series = Capex.analyzeSeries(sample);
check("sample series has 15–18 months", series.months.length >= 15 && series.months.length <= 18);
check("sample data is labeled as sample", sample.meta && (sample.meta.sample === true || /sample/i.test(sample.meta.note || "")));
check("sample latest total CapEx is finite", Capex.isFiniteNumber(series.latest && series.latest.total));
check("sample latest MoM is finite", Capex.isFiniteNumber(series.latest && series.latest.mom));
check("sample latest category mix sums to 1", Math.abs(Capex.CATEGORIES.reduce((s, k) => s + series.latest.mix[k], 0) - 1) < 1e-9);
check("sample latest CapEx-to-depreciation is finite", Capex.isFiniteNumber(series.latest && series.latest.capexToDepreciation));
check("sample months include depreciation", series.months.every((row) => Capex.isFiniteNumber(row.depreciation)));
NODE
)"

printf '%s\n' "$MATH_OUT"
while IFS= read -r line; do
  case "$line" in
    PASS:*) PASS=$((PASS + 1)) ;;
    FAIL:*) FAIL=$((FAIL + 1)) ;;
  esac
done <<< "$MATH_OUT"

# --- Static first-paint HTML ---
if [[ ! -f "$ROOT/index.html" ]]; then
  fail "index.html exists for first paint"
else
  pass "index.html exists for first paint"
fi

HTML="$(cat "$ROOT/index.html")"

if grep -q -E 'Loading…|Loading\.\.\.|Loading\.\.|id="loading"' "$ROOT/index.html"; then
  fail "static HTML has no Loading shell"
else
  pass "static HTML has no Loading shell"
fi

echo "$HTML" | grep -q "Total CapEx" && pass "static HTML includes Total CapEx" || fail "static HTML includes Total CapEx"
echo "$HTML" | grep -q "MoM change" && pass "static HTML includes MoM change" || fail "static HTML includes MoM change"
echo "$HTML" | grep -q "Category mix" && pass "static HTML includes Category mix" || fail "static HTML includes Category mix"
echo "$HTML" | grep -q "CapEx-to-depreciation" && pass "static HTML includes CapEx-to-depreciation" || fail "static HTML includes CapEx-to-depreciation"
echo "$HTML" | grep -q "Target comparisons" && pass "static HTML includes Target comparisons" || fail "static HTML includes Target comparisons"

ROW_COUNT="$(grep -c 'data-month="' "$ROOT/index.html" || true)"
if [[ "$ROW_COUNT" -ge 15 && "$ROW_COUNT" -le 18 ]]; then
  pass "static HTML has 15–18 month rows (${ROW_COUNT})"
else
  fail "static HTML has 15–18 month rows (found ${ROW_COUNT})"
fi

echo "$HTML" | grep -q 'data-month="2025-04"' && pass "static HTML includes first month 2025-04" || fail "static HTML includes first month 2025-04"
echo "$HTML" | grep -q 'data-month="2026-09"' && pass "static HTML includes last month 2026-09" || fail "static HTML includes last month 2026-09"

LATEST_TOTAL="$(node -e 'const C=require("./js/capex.js");const d=require("./data/capex.json");const s=C.analyzeSeries(d);process.stdout.write(C.formatMoney(s.latest.total));')"
echo "$HTML" | grep -F -q "$LATEST_TOTAL" && pass "baked Total CapEx value ${LATEST_TOTAL} is in HTML" || fail "baked Total CapEx value ${LATEST_TOTAL} is in HTML"

# curl -sL against a static server (no JS execution)
PORT=8766
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/capex-http.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
sleep 0.4

CURL_HTML="$(curl -sL "http://127.0.0.1:${PORT}/")"
if [[ -z "$CURL_HTML" ]]; then
  fail "curl -sL returns HTML"
else
  pass "curl -sL returns HTML"
fi

echo "$CURL_HTML" | grep -q "Total CapEx" && echo "$CURL_HTML" | grep -q "MoM change" && echo "$CURL_HTML" | grep -q "Category mix" && echo "$CURL_HTML" | grep -q "CapEx-to-depreciation" && echo "$CURL_HTML" | grep -q "Target comparisons" \
  && pass "curl -sL first paint includes Total CapEx / MoM / category mix / CapEx-to-depreciation / target comparisons" \
  || fail "curl -sL first paint includes Total CapEx / MoM / category mix / CapEx-to-depreciation / target comparisons"

CURL_ROWS="$(printf '%s\n' "$CURL_HTML" | grep -c 'data-month="' || true)"
if [[ "$CURL_ROWS" -ge 15 && "$CURL_ROWS" -le 18 ]]; then
  pass "curl -sL first paint includes ${CURL_ROWS} month rows"
else
  fail "curl -sL first paint includes 15–18 month rows (found ${CURL_ROWS})"
fi

if echo "$CURL_HTML" | grep -q -E 'Loading…|Loading\.\.\.|Loading\.\.|id="loading"'; then
  fail "curl -sL HTML has no Loading shell"
else
  pass "curl -sL HTML has no Loading shell"
fi

if [[ -f "$ROOT/.nojekyll" ]]; then
  pass ".nojekyll present for GitHub Pages"
else
  fail ".nojekyll present for GitHub Pages"
fi

echo "Summary: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0
