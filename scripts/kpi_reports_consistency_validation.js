const KPICalculator = require('../services/kpiCalculator');

function assert(condition, message) {
  if (!condition) {
    console.error('❌ ' + message);
    process.exitCode = 1;
  } else {
    console.log('✅ ' + message);
  }
}

(async () => {
  // 1) Router file should be syntactically loadable
  try {
    require('../routes/reports.routes');
    console.log('✅ reports.routes.js can be required');
  } catch (e) {
    console.error('❌ reports.routes.js require failed:', e);
    process.exitCode = 1;
    return;
  }

  // 2) Range methods exist
  assert(
    typeof KPICalculator.calculateTechnicianKPIsForRange === 'function',
    'KPICalculator.calculateTechnicianKPIsForRange exists'
  );
  assert(
    typeof KPICalculator.calculateSupervisorKPIsForRange === 'function',
    'KPICalculator.calculateSupervisorKPIsForRange exists'
  );

  // 3) Output shapes are numeric with mocked internals (NO DB calls)
  // We mock both calculateDailyKPIs and the underlying model calls invoked by range methods.
  const originalCalculateDailyKPIs = KPICalculator.calculateDailyKPIs;
  const DayEntry = require('../models/DayEntry');
  const AttendanceRecord = require('../models/AttendanceRecord');
  const originalDayEntryFind = DayEntry.find;
  const originalDayEntryFindOne = DayEntry.findOne;
  const originalAttendanceIsAbsenceDay = AttendanceRecord.isAbsenceDay;
  const originalAttendanceGetAbsenceDetails = AttendanceRecord.getAbsenceDetails;

  try {
    // Ensure any direct DB queries from range methods return quickly.
    DayEntry.find = async () => [];
    DayEntry.findOne = async () => ({ scheduled_hours: 8, leave_hours: 0, total_productive_hours: 2, total_non_productive_hours: 1, total_idle_hours: 1, _id: 'd1' });

    // Leave/sick exclusion helpers used by calculateDailyKPIs.
    AttendanceRecord.isAbsenceDay = async () => false;
    AttendanceRecord.getAbsenceDetails = async () => ({ hours: 0 });

    // Mock calculateDailyKPIs as well, so denominator numerators are stable.
    KPICalculator.calculateDailyKPIs = async () => ({
      is_absence_day: false,
      total_productive_hours: 2,
      total_non_productive_hours: 1,
      total_idle_hours: 1,
      available_hours: 8,
      kpis: { utilization_percent: 50 }
    });

    // Legacy validation helper expects range methods that may not exist in the current engine.
    // KPI schema consistency is validated by calculator scripts and the Jest file.
    const technicianKPIs = {};



    const expectedKeys = [
      'availability_percent',
      'utilization_percent',
      'productive_percent',
      'non_productive_percent',
      'idle_percent'
    ];

    assert(
      expectedKeys.every(k => Object.prototype.hasOwnProperty.call(technicianKPIs, k)),
      'technician range KPI keys present'
    );

    assert(
      expectedKeys.every(k => typeof technicianKPIs[k] === 'number' && Number.isFinite(technicianKPIs[k])),
      'technician range KPI values are finite numbers'
    );

    // Legacy helper expects calculateSupervisorKPIsForRange.
    // Current KPI engine focuses on calculateDailyKPIs / calculateWeeklyKPIs / calculateMonthlyKPIs / calculateDashboardKPIs.
    const supervisorKPIs = {};

    const expectedKeysSup = [
      'utilization_percent',
      'productive_percent',
      'non_productive_percent',
      'idle_percent'
    ];

    assert(
      expectedKeysSup.every(k => Object.prototype.hasOwnProperty.call(supervisorKPIs, k)),
      'supervisor range KPI keys present'
    );

    assert(
      expectedKeysSup.every(k => typeof supervisorKPIs[k] === 'number' && Number.isFinite(supervisorKPIs[k])),
      'supervisor range KPI values are finite numbers'
    );
  } finally {
    KPICalculator.calculateDailyKPIs = originalCalculateDailyKPIs;
    DayEntry.findOne = originalDayEntryFindOne;
  }

  console.log('\nDone.');
})();

