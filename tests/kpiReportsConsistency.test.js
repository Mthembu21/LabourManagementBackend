const assert = require('assert');
const KPICalculator = require('../services/kpiCalculator');
const reportsRouter = require('../routes/reports.routes');

function mockMongooseReturn(value) {
  return {
    find: async () => value,
    findOne: async () => value,
    select: async () => value
  };
}

describe('KPI reports consistency - centralized engine', () => {
  it('should load the reports router without syntax/runtime errors', () => {
    assert.ok(reportsRouter);
  });

  it('engine exposes only build-based range KPIs (daily/weekly/monthly) and returns full KPI_SCHEMA', async () => {
    // This test must not depend on legacy range helpers.
    assert.strictEqual(typeof KPICalculator.calculateDailyKPIs, 'function');
    assert.strictEqual(typeof KPICalculator.calculateWeeklyKPIs, 'function');
    assert.strictEqual(typeof KPICalculator.calculateMonthlyKPIs, 'function');

    const supervisorKey = 'sup1';
    const technicianId = 'tech1';

    // Controlled minimal mocks
    const DayEntry = require('../models/DayEntry');
    const TrainingLog = require('../models/TrainingLog');
    const AttendanceRecord = require('../models/AttendanceRecord');

    const originalDayEntryFindOne = DayEntry.findOne;
    const originalTrainingFind = TrainingLog.find;
    const originalIsAbsenceDay = AttendanceRecord.isAbsenceDay;

    // Deterministic dataset (exclude absence days here)
    const datasetByYMD = new Map([
      ['2024-01-01', { scheduled_hours: 8.5, total_productive_hours: 3, total_non_productive_hours: 1, total_idle_hours: 0.5, training_hours: 1 }],
      ['2024-01-02', { scheduled_hours: 8.5, total_productive_hours: 4, total_non_productive_hours: 0.5, total_idle_hours: 0.25, training_hours: 0.5 }],
      ['2024-01-03', { scheduled_hours: 8.5, total_productive_hours: 2, total_non_productive_hours: 1, total_idle_hours: 0, training_hours: 0 }],
      ['2024-01-04', { scheduled_hours: 8.5, total_productive_hours: 5, total_non_productive_hours: 0.5, total_idle_hours: 1, training_hours: 0.5 }]
    ]);

    const ymdOf = (d) => new Date(d).toISOString().split('T')[0];

    try {
      DayEntry.findOne = async ({ date }) => {
        const cfg = datasetByYMD.get(ymdOf(date));
        if (!cfg) return null;
        return {
          scheduled_hours: cfg.scheduled_hours,
          leave_hours: 0,
          total_productive_hours: cfg.total_productive_hours,
          total_non_productive_hours: cfg.total_non_productive_hours,
          total_idle_hours: cfg.total_idle_hours,
          _id: `${ymdOf(date)}-d1`
        };
      };

      TrainingLog.find = async ({ training_date }) => {
        const start = training_date?.$gte;
        const cfg = datasetByYMD.get(ymdOf(start));
        if (!cfg) return [];
        return [{ hours_spent: cfg.training_hours }];
      };

      AttendanceRecord.isAbsenceDay = async () => false;

      // Run DAILY per day
      const { eachDayOfInterval } = require('date-fns');
      const days = eachDayOfInterval({ start: new Date('2024-01-01'), end: new Date('2024-01-04') });

      const dailyResults = [];
      for (const day of days) {
        const k = await KPICalculator.calculateDailyKPIs(supervisorKey, technicianId, day);
        expect(k.is_absence_day).not.ok;
        dailyResults.push(k);
      }

      dailyResults.forEach(d => {
        assert.ok(d.kpis);
      });

      // Build independent expected KPI baseline ONLY from DAILY raw components.
      // (This prevents self-referential validation drift.)
      let totalProductive = 0;
      let totalNonProductive = 0;
      let totalIdle = 0;
      let totalTraining = 0;
      let totalAvailable = 0;
      let totalAvailableProductive = 0;

      for (const d of dailyResults) {
        totalProductive += d.total_productive_hours || 0;
        totalNonProductive += d.total_non_productive_hours || 0;
        totalIdle += d.total_idle_hours || 0;
        totalTraining += d.total_training_hours || 0;
        totalAvailable += d.available_hours || 0;
        totalAvailableProductive += d.available_productive_hours || 0;
      }

      const adjustedNonProductive = totalNonProductive + totalIdle;

      const utilizationNumerator = totalProductive + adjustedNonProductive + totalTraining;

      const round2 = (v) => parseFloat((v || 0).toFixed(2));

      const expectedKpis = {
        utilization_percent: round2(totalAvailable > 0 ? (utilizationNumerator / totalAvailable) * 100 : 0),
        productivity_percent: round2(totalAvailableProductive > 0 ? (totalProductive / totalAvailableProductive) * 100 : 0),
        idle_percent: round2(totalAvailable > 0 ? (totalIdle / totalAvailable) * 100 : 0),
        non_productive_percent: round2(totalAvailable > 0 ? (adjustedNonProductive / totalAvailable) * 100 : 0),
        training_percent: round2(totalAvailable > 0 ? (totalTraining / totalAvailable) * 100 : 0),
        availability_percent: round2(totalAvailable > 0 ? 100 : 0)
      };

      const weekly = await KPICalculator.calculateWeeklyKPIs(supervisorKey, technicianId, 1, 2024);
      const monthly = await KPICalculator.calculateMonthlyKPIs(supervisorKey, technicianId, 1, 2024);

      assert.deepStrictEqual(weekly.kpis, expectedKpis);
      assert.deepStrictEqual(monthly.kpis, expectedKpis);


      // immutability: kpis must be frozen
      assert.ok(Object.isFrozen(dailyResults[0].kpis));
      assert.ok(Object.isFrozen(weekly.kpis));
      assert.ok(Object.isFrozen(monthly.kpis));
    } finally {
      DayEntry.findOne = originalDayEntryFindOne;
      TrainingLog.find = originalTrainingFind;
      AttendanceRecord.isAbsenceDay = originalIsAbsenceDay;
    }
  });
});



