# KPI Refactor Hardening TODO (LabourManagementBackend)

## Step 1 — Runtime KPI schema enforcement
- [x] Confirm buildKpis() always calls KPI schema validator before returning.
- [ ] Harden validator to strictly enforce EXACT keys + no extras.
- [ ] Ensure all KPI response paths (including absence) produce valid schema objects.

## Step 2 — Weekly KPI audit (no manual percent math)
- [x] Remove leftover manual KPI percent calculations in calculateWeeklyKPIs().
- [ ] Confirm there is no other manual KPI percent math outside buildKpis() in weekly/monthly/dashboard.

## Step 3 — Cross-level determinism test (Daily === Weekly === Monthly)
- [ ] Add deterministic test using fixed data.
- [ ] Exclude absence days from equality comparison (NON-NEGOTIABLE constraint).
- [ ] Assert EXACT match of all KPI fields.

## Step 4 — Legacy validation cleanup
- [ ] Update scripts/kpi_reports_consistency_validation.js to remove deprecated range-method references.
- [ ] Replace assertions to be based ONLY on current KPI calculator methods + buildKpis() outputs.

## Step 5 — Test run
- [ ] Run backend tests (npm test) and scripts validation.

