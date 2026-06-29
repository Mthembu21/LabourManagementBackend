# Debug KPI determinism (cross-level)

## Status
- Implemented changes in `services/kpiCalculator.js`.
- Current failing Jest assertion: **Expected 81.12, Received 45.45**.

## Required next step (single change only)
- Instrument weekly/monthly calculation to print daily component breakdown and compare sums.

## TODO
1. Add temporary console logging inside `calculateWeeklyKPIs` loop to print, per day:
   - date (ISO)
   - available_hours
   - available_productive_hours
   - total_productive_hours
   - total_non_productive_hours
   - total_idle_hours
   - total_training_hours
2. Run the failing Jest test:
   - `npx jest --runTestsByPath tests/kpiCrossLevelDeterminism.test.js`
3. Compute and compare:
   - Sum of daily numerator components vs weekly denominator components
4. Identify the exact field that causes the drop (one of):
   - productive hours loss
   - availability denominator mismatch
   - training inclusion/exclusion difference
   - idle/non-productive misalignment
5. Apply a minimal fix (single change) that aligns daily/weekly/monthly math.

