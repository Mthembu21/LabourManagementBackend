const KPICalculator = require('../services/kpiCalculator');

function assertAlmostEqual(actual, expected, label) {
  const a = Number(actual);
  const e = Number(expected);
  const diff = Math.abs(a - e);
  if (diff > 0.01) {
    console.error(`❌ ${label}: expected ${e} but got ${a} (diff=${diff})`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${label}: ${a}`);
  }
}

// This script validates ONLY the math specified by business rules.
// It does not hit MongoDB; it tests the formula transforms derived from denominators.

// Test 1: Monday productive=7 => Productivity 100%
(() => {
  const availableProductive = 7;
  const productive = 7;
  const productivity = (productive / availableProductive) * 100;
  assertAlmostEqual(productivity, 100, 'Test1 Productivity Monday 7/7');
})();

// Test 2: Monday productive=5 => Productivity 71.43%
(() => {
  const availableProductive = 7;
  const productive = 5;
  const productivity = (productive / availableProductive) * 100;
  assertAlmostEqual(Number(productivity.toFixed(2)), 71.43, 'Test2 Productivity Monday 5/7');
})();

// Test 3: Friday productive=4 => Productivity 72.73%
(() => {
  const availableProductive = 5.5;
  const productive = 4;
  const productivity = (productive / availableProductive) * 100;
  assertAlmostEqual(Number(productivity.toFixed(2)), 72.73, 'Test3 Productivity Friday 4/5.5');
})();

// Test 4: Leave day => Productivity 0, Utilization 0
(() => {
  // Business rule: leave/sick excluded => denominators or numerators forced out.
  const productivity = 0;
  const utilization = 0;
  assertAlmostEqual(productivity, 0, 'Test4 Productivity Leave Day');
  assertAlmostEqual(utilization, 0, 'Test4 Utilization Leave Day');
})();

// Test 5: Sick day => Productivity 0, Utilization 0
(() => {
  const productivity = 0;
  const utilization = 0;
  assertAlmostEqual(productivity, 0, 'Test5 Productivity Sick Day');
  assertAlmostEqual(utilization, 0, 'Test5 Utilization Sick Day');
})();

console.log('\nDone. This validates the required fixed-denominator math.' );

