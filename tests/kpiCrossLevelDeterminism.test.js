const assert = require('assert');
const KPICalculator = require('../services/kpiCalculator');

function approxEqualStrict(a, b) {
  assert.strictEqual(Number(a), Number(b));
}

describe('KPI cross-level determinism (hard trust layer)', () => {
  it('Daily KPI == Weekly KPI == Monthly KPI (excluding absence days) for same technician + same dataset + same date range', async () => {
    const supervisorKey = 'sup1';
    const technicianId = 'tech1';

    const year = 2024;
    const month = 1;
    const weekNumber = 1;

    // Controlled dataset: we mock only data sources (DayEntry/TrainingLog/AttendanceRecord).
    // KPI math must remain untouched (determinism proven end-to-end).
    const datasetByYMD = new Map([
      ['2024-01-03', { absence: true }],

      ['2024-01-01', { absence: false, scheduled_hours: 8.5, total_productive_hours: 3, total_non_productive_hours: 1, total_idle_hours: 2, training_hours: 1 }],
      ['2024-01-02', { absence: false, scheduled_hours: 8.5, total_productive_hours: 0, total_non_productive_hours: 1, total_idle_hours: 0.5, training_hours: 0.5 }],
      ['2024-01-04', { absence: false, scheduled_hours: 8.5, total_productive_hours: 6, total_non_productive_hours: 0.5, total_idle_hours: 0, training_hours: 0 }],
      ['2024-01-05', { absence: false, scheduled_hours: 7, total_productive_hours: 2, total_non_productive_hours: 1, total_idle_hours: 1.5, training_hours: 0 }]
    ]);

    const defaultDay = {
      absence: false,
      scheduled_hours: 8.5,
      total_productive_hours: 4,
      total_non_productive_hours: 1,
      total_idle_hours: 1,
      training_hours: 1
    };

    const DayEntry = require('../models/DayEntry');
    const TrainingLog = require('../models/TrainingLog');
    const AttendanceRecord = require('../models/AttendanceRecord');

    const originalDayEntryFindOne = DayEntry.findOne;
    const originalTrainingLogFind = TrainingLog.find;
    const originalAttendanceIsAbsenceDay = AttendanceRecord.isAbsenceDay;

    function ymdOf(date) {
      return new Date(date).toISOString().split('T')[0];
    }

    // Mock data sources
    DayEntry.findOne = async ({ date }) => {
      const ymd = ymdOf(date);
      const cfg = datasetByYMD.get(ymd) || null;
      const base = cfg || defaultDay;
      if (base.absence) return null; // engine returns _empty when no DayEntry
      return {
        scheduled_hours: base.scheduled_hours,
        leave_hours: 0,
        total_productive_hours: base.total_productive_hours,
        total_non_productive_hours: base.total_non_productive_hours,
        total_idle_hours: base.total_idle_hours,
        _id: `${ymd}-d1`
      };
    };

    TrainingLog.find = async ({ training_date }) => {
      const start = training_date?.$gte;
      const ymd = ymdOf(start);
      const cfg = datasetByYMD.get(ymd) || null;
      const base = cfg || defaultDay;
      if (base.absence) return [];
      return [{ hours_spent: base.training_hours }];
    };

    AttendanceRecord.isAbsenceDay = async (_sup, _tech, date) => {
      const ymd = ymdOf(date);
      const cfg = datasetByYMD.get(ymd) || null;
      const base = cfg || defaultDay;
      return !!base.absence;
    };

    try {
      const dailyKpiFields = [
        'utilization_percent',
        'productivity_percent',
        'idle_percent',
        'non_productive_percent',
        'training_percent',
        'availability_percent'
      ];

      const { eachDayOfInterval } = require('date-fns');
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');
      const days = eachDayOfInterval({ start: from, end: to });

      // Compute expected cross-level KPIs by *directly using the engine's own daily kpis*.
      // This guarantees determinism with identical absence-day exclusion and identical denominators.
      const dailyNonAbsence = [];
      for (const d of days) {
        const k = await KPICalculator.calculateDailyKPIs(supervisorKey, technicianId, d);
        if (k.is_absence_day) continue;
        dailyNonAbsence.push(k);
      }

      let totalAvailable = 0;
      let totalProductive = 0;
      let totalNonProductive = 0;
      let totalIdle = 0;
      let totalTraining = 0;
      let totalAvailableProductive = 0;

      for (const k of dailyNonAbsence) {
        totalAvailable += k.available_hours || 0;
        totalProductive += k.total_productive_hours || 0;
        totalNonProductive += k.total_non_productive_hours || 0;
        totalIdle += k.total_idle_hours || 0;
        totalTraining += k.total_training_hours || 0;
        // denominators are fixed by weekday/friday in the engine
        const dow = new Date(k.date).getDay();
        totalAvailableProductive += dow === 5 ? 5.5 : 7;
      }

      const adjustedNonProductive = totalNonProductive + totalIdle;
      const utilizationNumerator = totalProductive + adjustedNonProductive + totalTraining;

      const round2 = (v) => parseFloat((v || 0).toFixed(2));
      const dailyAggregateKpis = {
        utilization_percent: round2(totalAvailable > 0 ? (utilizationNumerator / totalAvailable) * 100 : 0),
        productivity_percent: round2(totalAvailableProductive > 0 ? (totalProductive / totalAvailableProductive) * 100 : 0),
        idle_percent: round2(totalAvailable > 0 ? (totalIdle / totalAvailable) * 100 : 0),
        non_productive_percent: round2(totalAvailable > 0 ? (adjustedNonProductive / totalAvailable) * 100 : 0),
        training_percent: round2(totalAvailable > 0 ? (totalTraining / totalAvailable) * 100 : 0),
        availability_percent: round2(totalAvailable > 0 ? 100 : 0)
      };


      const weekly = await KPICalculator.calculateWeeklyKPIs(supervisorKey, technicianId, weekNumber, year);
      const monthly = await KPICalculator.calculateMonthlyKPIs(supervisorKey, technicianId, month, year);

      // Determinism enforcement (strict equality on rounded KPI percents).
      for (const f of dailyKpiFields) {
        approxEqualStrict(weekly.kpis[f], dailyAggregateKpis[f]);
        approxEqualStrict(monthly.kpis[f], dailyAggregateKpis[f]);
      }
    } finally {
      DayEntry.findOne = originalDayEntryFindOne;
      TrainingLog.find = originalTrainingLogFind;
      AttendanceRecord.isAbsenceDay = originalAttendanceIsAbsenceDay;
    }
  });
});

