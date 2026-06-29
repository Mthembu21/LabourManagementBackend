// // /**
// //  * Central KPI Calculator Engine (Single Source of Truth)
// //  *
// //  * IMPORTANT (architecture):
// //  * - No KPI math in routes. All KPI calculations live here.
// //  * - No TimeLog-based KPI calculations in this engine.
// //  * - Leave/Sick exclusion is driven ONLY by AttendanceRecord.status === 'approved'.
// //  * - Overtime + Downtime are excluded from Productivity and Utilization.
// //  */

// // const DayEntry = require('../models/DayEntry');
// // const TrainingLog = require('../models/TrainingLog');
// // const OvertimeLog = require('../models/OvertimeLog');
// // const DowntimeLog = require('../models/DowntimeLog');
// // const Job = require('../models/Job');
// // const AttendanceRecord = require('../models/AttendanceRecord');

// // // Note: WeekEntry/OvertimeLog are not used by daily utilization formulas directly.
// // // WeekEntry remains in data model, but KPI aggregation is recomputed from DayEntry.

// // // Business rule configuration (NOT hardcoded in formulas)
// // const SYSTEM_ALLOCATED = {
// //   meetingMinutes: 15,
// //   teaBreakMinutes: 15,
// //   lunchMinutes: 30,
// //   housekeepingMinutes: 30
// // };

// // const MINUTES_TO_HOURS = 1 / 60;

// // // Fixed denominators by day-of-week
// // // (Used to compute Availability/Productivity/Utilization)
// // const AVAILABLE_PRODUCTIVE_HOURS = {
// //   weekday: 7, // Mon-Thu
// //   friday: 5.5
// // };

// // const AVAILABLE_HOURS = {
// //   weekday: 8.5, // Mon-Thu
// //   friday: 7
// // };

// // function _round(value) {
// //   return parseFloat((value || 0).toFixed(2));
// // }

// // function _isFriday(date) {
// //   return new Date(date).getDay() === 5;
// // }

// // function _getAvailableProductiveHours(date) {
// //   return _isFriday(date) ? AVAILABLE_PRODUCTIVE_HOURS.friday : AVAILABLE_PRODUCTIVE_HOURS.weekday;
// // }

// // function _getAvailableHours(date) {
// //   return _isFriday(date) ? AVAILABLE_HOURS.friday : AVAILABLE_HOURS.weekday;
// // }

// // function _systemAllocatedUtilizationHours() {
// //   const totalMinutes =
// //     SYSTEM_ALLOCATED.meetingMinutes +
// //     SYSTEM_ALLOCATED.teaBreakMinutes +
// //     SYSTEM_ALLOCATED.lunchMinutes +
// //     SYSTEM_ALLOCATED.housekeepingMinutes;

// //   return totalMinutes * MINUTES_TO_HOURS;
// // }

// // async function _getApprovedAbsenceHoursByDate(supervisorKey, technicianId, date) {
// //   const isApprovedAbsence = await AttendanceRecord.isAbsenceDay(supervisorKey, technicianId, date);
// //   if (!isApprovedAbsence) return 0;
// //   const details = await AttendanceRecord.getAbsenceDetails(supervisorKey, technicianId, date);
// //   return details?.hours || 0;
// // }

// // function _getDayFromMidday(date) {
// //   const d = new Date(date);
// //   d.setHours(0, 0, 0, 0);
// //   return d;
// // }

// // function _toYMD(date) {
// //   const d = new Date(date);
// //   d.setHours(0, 0, 0, 0);
// //   return d.toISOString().split('T')[0];
// // }

// // function _mondayStart(date) {
// //   const d = new Date(date);
// //   const dow = d.getDay(); // 0=Sun..6=Sat
// //   // shift so Monday is start
// //   const diff = (dow === 0 ? -6 : 1) - dow;
// //   d.setDate(d.getDate() + diff);
// //   d.setHours(0, 0, 0, 0);
// //   return d;
// // }

// // class KPICalculator {
// //   // -------------------------------
// //   // Single-day KPI engine
// //   // -------------------------------
// //   static async calculateDailyKPIs(supervisorKey, technicianId, date) {
// //     const day = _getDayFromMidday(date);

// //     const dayEntry = await DayEntry.findOne({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       date: day
// //     });

// //     if (!dayEntry) return this._emptyDayKpis(day);

// //     const approvedAbsenceHours = await _getApprovedAbsenceHoursByDate(supervisorKey, technicianId, day);
// //     if (approvedAbsenceHours > 0) {
// //       return {
// //         date: day,
// //         scheduled_hours: dayEntry.scheduled_hours,
// //         leave_hours: approvedAbsenceHours,
// //         available_hours: 0,
// //         total_productive_hours: 0,
// //         total_non_productive_hours: 0,
// //         total_idle_hours: 0,
// //         total_overtime_hours: 0,
// //         total_downtime_hours: 0,
// //         is_absence_day: true,
// //         absence_type: dayEntry.is_leave_day ? 'leave' : 'sick',
// //         kpis: {
// //           availability_percent: 0,
// //           productive_percent: 0,
// //           non_productive_percent: 0,
// //           idle_percent: 0,
// //           utilization_percent: 0,
// //           productivity_percent: 0,
// //           efficiency_percent: 0
// //         },
// //         entry_id: dayEntry._id
// //       };
// //     }

// //     const availableProductiveHours = _getAvailableProductiveHours(day);
// //     const availableHours = _getAvailableHours(day);

// //     const productiveHours = dayEntry.total_productive_hours || 0;
// //     const nonProductiveHours = dayEntry.total_non_productive_hours || 0;
// //     const idleHours = dayEntry.total_idle_hours || 0;

// //     const trainingLogs = await TrainingLog.find({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       training_date: { $gte: day, $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1) }
// //     });

// //     const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);

// //     // Utilization numerator (single source of truth):
// //     // utilization hours = productive + training + non-productive + idle
// //     // NOTE: do NOT clamp here; clamping breaks correctness and hides KPI engine issues.
// //     const utilizedHours = productiveHours + trainingHours + nonProductiveHours + idleHours;

// //     const productivityPercent = availableProductiveHours > 0 ? (productiveHours / availableProductiveHours) * 100 : 0;
// //     const utilizationPercent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;


// //     const availabilityPercent = availableHours > 0 ? 100 : 0;
// //     const idlePercent = availableHours > 0 ? (idleHours / availableHours) * 100 : 0;
// //     const nonProductivePercent = availableHours > 0 ? (nonProductiveHours / availableHours) * 100 : 0;

// //     return {
// //       date: day,
// //       scheduled_hours: dayEntry.scheduled_hours,
// //       leave_hours: 0,
// //       available_hours: availableHours,
// //       total_productive_hours: productiveHours,
// //       total_non_productive_hours: nonProductiveHours,
// //       total_idle_hours: idleHours,
// //       total_overtime_hours: 0,
// //       total_downtime_hours: 0,
// //       is_absence_day: false,
// //       kpis: {
// //         availability_percent: _round(availabilityPercent),
// //         productive_percent: _round(productiveHours > 0 ? productivityPercent : productivityPercent),
// //         non_productive_percent: _round(nonProductivePercent),
// //         idle_percent: _round(idlePercent),
// //         utilization_percent: _round(utilizationPercent),

// //         productivity_percent: _round(productivityPercent),
// //         efficiency_percent: 0
// //       },
// //       entry_id: dayEntry._id
// //     };
// //   }

// //   static _emptyDayKpis(day) {
// //     return {
// //       date: day,
// //       scheduled_hours: 0,
// //       leave_hours: 0,
// //       available_hours: 0,
// //       total_productive_hours: 0,
// //       total_non_productive_hours: 0,
// //       total_idle_hours: 0,
// //       total_overtime_hours: 0,
// //       total_downtime_hours: 0,
// //       is_absence_day: false,
// //       kpis: {
// //         availability_percent: 0,
// //         productive_percent: 0,
// //         non_productive_percent: 0,
// //         idle_percent: 0,
// //         utilization_percent: 0,
// //         productivity_percent: 0,
// //         efficiency_percent: 0
// //       },
// //       entry_id: null
// //     };
// //   }

// //   // -------------------------------
// //   // Weekly / Monthly / Dashboard KPI aggregation
// //   // -------------------------------
// //   static async calculateWeeklyKPIs(supervisorKey, technicianId, weekNumber, year) {
// //     const startDate = this._getWeekStartDate(year, weekNumber);
// //     const endDate = new Date(startDate);
// //     // inclusive interval: 7 days
// //     endDate.setDate(endDate.getDate() + 6);


// //     const { eachDayOfInterval } = require('date-fns');
// //     const days = eachDayOfInterval({ start: startDate, end: endDate });

// //     let totalProductiveHours = 0;
// //     let totalNonProductiveHours = 0;
// //     let totalIdleHours = 0;
// //     let totalTrainingHours = 0;
// //     let totalAvailableHours = 0;
// //     let totalAvailableProductiveHours = 0;

// //     for (const d of days) {
// //       const day = _getDayFromMidday(d);
// //       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, day);
// //       totalAvailableProductiveHours += _getAvailableProductiveHours(day);
// //       totalAvailableHours += _getAvailableHours(day);

// //       if (k.is_absence_day) continue;

// //       totalProductiveHours += k.total_productive_hours || 0;
// //       totalNonProductiveHours += k.total_non_productive_hours || 0;
// //       totalIdleHours += k.total_idle_hours || 0;

// //       const trainingLogs = await TrainingLog.find({
// //         supervisor_key: supervisorKey,
// //         technician_id: technicianId,
// //         training_date: {
// //           $gte: day,
// //           $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)
// //         }
// //       });
// //       const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
// //       totalTrainingHours += trainingHours;
// //     }

// //     const utilizedHoursTotal =
// //       totalProductiveHours +
// //       totalTrainingHours +
// //       totalNonProductiveHours +
// //       totalIdleHours;

// //     const utilizationPercent = totalAvailableHours > 0 ? (utilizedHoursTotal / totalAvailableHours) * 100 : 0;
// //     const productivityPercent = totalAvailableProductiveHours > 0 ? (totalProductiveHours / totalAvailableProductiveHours) * 100 : 0;

// //     return {
// //       week: weekNumber,
// //       year,
// //       scheduled_hours: null,
// //       leave_hours: null,
// //       available_hours: totalAvailableHours,
// //       total_productive_hours: totalProductiveHours,
// //       total_non_productive_hours: totalNonProductiveHours,
// //       total_idle_hours: totalIdleHours,
// //       total_overtime_hours: 0,
// //       total_downtime_hours: 0,
// //       kpis: {
// //         availability_percent: totalAvailableHours > 0 ? 100 : 0,
// //         productive_percent: _round((totalProductiveHours / totalAvailableProductiveHours) * 100),
// //         non_productive_percent: totalAvailableHours > 0 ? _round((totalNonProductiveHours / totalAvailableHours) * 100) : 0,
// //         idle_percent: totalAvailableHours > 0 ? _round((totalIdleHours / totalAvailableHours) * 100) : 0,
// //         utilization_percent: _round(utilizationPercent),
// //         productivity_percent: _round(productivityPercent),
// //         efficiency_percent: 0
// //       },
// //       entry_id: null
// //     };
// //   }

// //   static async calculateMonthlyKPIs(supervisorKey, technicianId, month, year) {
// //     const monthNum = parseInt(month);
// //     const yearNum = parseInt(year);

// //     const startDate = new Date(yearNum, monthNum - 1, 1);
// //     const endDate = new Date(yearNum, monthNum, 0);

// //     const { eachDayOfInterval } = require('date-fns');
// //     const days = eachDayOfInterval({ start: startDate, end: endDate });

// //     let totalProductiveHours = 0;
// //     let totalNonProductiveHours = 0;
// //     let totalIdleHours = 0;
// //     let totalTrainingHours = 0;
// //     let totalAvailableHours = 0;
// //     let totalAvailableProductiveHours = 0;

// //     for (const d of days) {
// //       const dow = new Date(d).getDay();
// //       if (dow === 0 || dow === 6) continue;

// //       totalAvailableProductiveHours += _getAvailableProductiveHours(d);
// //       totalAvailableHours += _getAvailableHours(d);

// //       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);
// //       if (k.is_absence_day) continue;

// //       totalProductiveHours += k.total_productive_hours || 0;
// //       totalNonProductiveHours += k.total_non_productive_hours || 0;
// //       totalIdleHours += k.total_idle_hours || 0;

// //       const trainingLogs = await TrainingLog.find({
// //         supervisor_key: supervisorKey,
// //         technician_id: technicianId,
// //         training_date: { $gte: _getDayFromMidday(d), $lte: new Date(new Date(d).getTime() + 24 * 60 * 60 * 1000 - 1) }
// //       });
// //       const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
// //       totalTrainingHours += trainingHours;

// //     }

// //     const utilizedHoursTotal =
// //       totalProductiveHours +
// //       totalTrainingHours +
// //       totalNonProductiveHours +
// //       totalIdleHours;

// //     const utilizationPercent = totalAvailableHours > 0 ? (utilizedHoursTotal / totalAvailableHours) * 100 : 0;
// //     const productivityPercent = totalAvailableProductiveHours > 0 ? (totalProductiveHours / totalAvailableProductiveHours) * 100 : 0;

// //     return {
// //       period: 'monthly',
// //       month: monthNum,
// //       year: yearNum,
// //       working_days: null,
// //       hours: {
// //         total_scheduled: null,
// //         total_leave: null,
// //         total_productive: totalProductiveHours,
// //         total_non_productive: totalNonProductiveHours,
// //         total_idle: totalIdleHours,
// //         total_overtime: 0,
// //         total_downtime: 0,
// //         available_hours: totalAvailableHours
// //       },
// //       kpis: {
// //         availability_percent: totalAvailableHours > 0 ? 100 : 0,
// //         productive_percent: totalAvailableProductiveHours > 0 ? _round((totalProductiveHours / totalAvailableProductiveHours) * 100) : 0,
// //         non_productive_percent: totalAvailableHours > 0 ? _round((totalNonProductiveHours / totalAvailableHours) * 100) : 0,
// //         idle_percent: totalAvailableHours > 0 ? _round((totalIdleHours / totalAvailableHours) * 100) : 0,
// //         utilization_percent: _round(utilizationPercent),
// //         productivity_percent: _round(productivityPercent),
// //         efficiency_percent: 0
// //       }
// //     };
// //   }

// //   static async calculateDashboardKPIs(supervisorKey, dateFrom, dateTo) {
// //     const { eachDayOfInterval } = require('date-fns');
// //     const days = eachDayOfInterval({ start: new Date(dateFrom), end: new Date(dateTo) });

// //     const dayEntries = await DayEntry.find({
// //       supervisor_key: supervisorKey,
// //       date: { $gte: new Date(dateFrom), $lte: new Date(dateTo) }
// //     });

// //     const uniqueTechs = new Set(dayEntries.map(e => e.technician_id.toString()));

// //     let totalAvailableHours = 0;
// //     let totalUtilizedHours = 0;
// //     let totalProductiveHours = 0;
// //     let totalNonProductiveHours = 0;
// //     let totalIdleHours = 0;

// //     for (const techIdStr of uniqueTechs) {
// //       const technicianId = techIdStr;
// //       for (const d of days) {
// //         const dow = new Date(d).getDay();
// //         if (dow === 0 || dow === 6) continue;

// //         const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);
// //         totalAvailableHours += _getAvailableHours(d);

// //         if (k.is_absence_day) continue;

// //         totalProductiveHours += k.total_productive_hours || 0;
// //         totalNonProductiveHours += k.total_non_productive_hours || 0;
// //         totalIdleHours += k.total_idle_hours || 0;

// //         const trainingLogs = await TrainingLog.find({
// //           supervisor_key: supervisorKey,
// //           technician_id: technicianId,
// //           training_date: {
// //             $gte: _getDayFromMidday(d),
// //             $lte: new Date(new Date(d).getTime() + 24 * 60 * 60 * 1000 - 1)
// //           }
// //         });
// //         const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);

// //         totalUtilizedHours += (k.total_productive_hours || 0) +
// //           (k.total_non_productive_hours || 0) +
// //           trainingHours +
// //           (k.total_idle_hours || 0);

// //       }
// //     }

// //     const utilizationPercent = totalAvailableHours > 0 ? (totalUtilizedHours / totalAvailableHours) * 100 : 0;
// //     return {
// //       period: { from: dateFrom, to: dateTo },
// //       technicians_count: uniqueTechs.size,
// //       entries_count: dayEntries.length,
// //       hours: {
// //         total_scheduled: null,
// //         total_leave: null,
// //         total_productive: _round(totalProductiveHours),
// //         total_non_productive: _round(totalNonProductiveHours),
// //         total_idle: _round(totalIdleHours),
// //         total_overtime: 0,
// //         total_downtime: 0,
// //         available_hours: _round(totalAvailableHours)
// //       },
// //       kpis: {
// //         productive_percent: totalAvailableHours > 0 ? _round((totalProductiveHours / totalAvailableHours) * 100) : 0,
// //         non_productive_percent: totalAvailableHours > 0 ? _round((totalNonProductiveHours / totalAvailableHours) * 100) : 0,
// //         idle_percent: totalAvailableHours > 0 ? _round((totalIdleHours / totalAvailableHours) * 100) : 0,
// //         efficiency_percent: 0,
// //         availability_percent: totalAvailableHours > 0 ? 100 : 0,
// //         utilization_percent: _round(utilizationPercent)
// //       },
// //       jobs: {
// //         active_jobs: 0,
// //         completed_jobs: 0,
// //         at_risk_jobs: 0,
// //         total_jobs: 0
// //       }
// //     };
// //   }

// //   static async calculateTechnicianKPIsForRange(supervisorKey, technicianId, startDate, endDate) {
// //     const { eachDayOfInterval } = require('date-fns');
// //     const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

// //     let totalScheduled = 0;
// //     let totalLeave = 0;

// //     let productiveHours = 0;
// //     let nonProductiveHours = 0;
// //     let idleHours = 0;
// //     let trainingHours = 0;

// //     for (const d of days) {
// //       const day = _getDayFromMidday(d);

// //       const dayEntry = await DayEntry.findOne({
// //         supervisor_key: supervisorKey,
// //         technician_id: technicianId,
// //         date: day
// //       });
// //       if (!dayEntry) continue;

// //       totalScheduled += dayEntry.scheduled_hours || 0;
// //       totalLeave += dayEntry.leave_hours || 0;

// //       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, day);
// //       if (k.is_absence_day) continue;

// //       productiveHours += k.total_productive_hours || 0;
// //       nonProductiveHours += k.total_non_productive_hours || 0;
// //       idleHours += k.total_idle_hours || 0;

// //       const trainingLogs = await TrainingLog.find({
// //         supervisor_key: supervisorKey,
// //         technician_id: technicianId,
// //         training_date: {
// //           $gte: day,
// //           $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)
// //         }
// //       });
// //       trainingHours += trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
// //     }

// //     const availableHours = Math.max(0, totalScheduled - totalLeave);

// //     const utilizedHours = productiveHours + nonProductiveHours + idleHours + trainingHours;
// //     const utilizationPercent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;
// //     const productive_percent = availableHours > 0 ? (productiveHours / availableHours) * 100 : 0;
// //     const non_productive_percent = availableHours > 0 ? (nonProductiveHours / availableHours) * 100 : 0;
// //     const idle_percent = availableHours > 0 ? (idleHours / availableHours) * 100 : 0;

// //     const availability_percent = totalScheduled > 0 ? (availableHours / totalScheduled) * 100 : 0;

// //     return {
// //       availability_percent: _round(availability_percent),
// //       utilization_percent: _round(utilizationPercent),
// //       productive_percent: _round(productive_percent),
// //       non_productive_percent: _round(non_productive_percent),
// //       idle_percent: _round(idle_percent)
// //     };
// //   }

// //   static async calculateSupervisorKPIsForRange(supervisorKey, startDate, endDate) {
// //     const { eachDayOfInterval } = require('date-fns');
// //     const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

// //     const dayEntries = await DayEntry.find({
// //       supervisor_key: supervisorKey,
// //       date: { $gte: new Date(startDate), $lte: new Date(endDate) }
// //     });

// //     const uniqueTechs = new Set(dayEntries.map(e => e.technician_id.toString()));

// //     let totalScheduled = 0;
// //     let totalLeave = 0;

// //     let productiveHours = 0;
// //     let nonProductiveHours = 0;
// //     let idleHours = 0;
// //     let trainingHours = 0;

// //     for (const techId of uniqueTechs) {
// //       for (const d of days) {
// //         const day = _getDayFromMidday(d);

// //         const dayEntry = await DayEntry.findOne({
// //           supervisor_key: supervisorKey,
// //           technician_id: techId,
// //           date: day
// //         });

// //         if (!dayEntry) continue;

// //         totalScheduled += dayEntry.scheduled_hours || 0;
// //         totalLeave += dayEntry.leave_hours || 0;

// //         const k = await this.calculateDailyKPIs(supervisorKey, techId, day);
// //         if (k.is_absence_day) continue;

// //         productiveHours += k.total_productive_hours || 0;
// //         nonProductiveHours += k.total_non_productive_hours || 0;
// //         idleHours += k.total_idle_hours || 0;

// //         const trainingLogs = await TrainingLog.find({
// //           supervisor_key: supervisorKey,
// //           technician_id: techId,
// //           training_date: {
// //             $gte: day,
// //             $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)
// //           }
// //         });
// //         trainingHours += trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
// //       }
// //     }

// //     const availableHours = Math.max(0, totalScheduled - totalLeave);
// //     const utilizedHours = productiveHours + nonProductiveHours + idleHours + trainingHours;
// //     const utilizationPercent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;


// //   static _getWeekStartDate(year, weekNumber) {
// //     const firstDay = new Date(year, 0, 1);
// //     const firstDayDow = firstDay.getDay() || 7; // Sunday=7
// //     const offset = 1 - firstDayDow;
// //     const firstMonday = new Date(year, 0, 1 + offset);
// //     const weekStart = new Date(firstMonday);
// //     weekStart.setDate(firstMonday.getDate() + (weekNumber - 1) * 7);
// //     return weekStart;
// //   }

// //   // -------------------------------
// //   // Trends API (Supervisor-level)
// //   // -------------------------------
// //   static async calculateTrendKPIs(trendType, supervisorKey, { start_date, end_date } = {}) {
// //     const startDate = start_date ? new Date(start_date) : new Date(new Date().setMonth(new Date().getMonth() - 1));
// //     const endDate = end_date ? new Date(end_date) : new Date();

// //     const { eachDayOfInterval } = require('date-fns');
// //     const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

// //     const technicianIds = await (async () => {
// //       const entries = await DayEntry.find({
// //         supervisor_key: supervisorKey,
// //         date: { $gte: startDate, $lte: endDate }
// //       }).select({ technician_id: 1 });
// //       return Array.from(new Set(entries.map(e => e.technician_id.toString())));
// //     })();

// //     const aggregateForDay = async (d) => {
// //       let availableHours = 0;
// //       let utilizedHours = 0;
// //       let productiveHours = 0;
// //       let nonProductiveHours = 0;
// //       let idleHours = 0;

// //       for (const techId of technicianIds) {
// //         const k = await this.calculateDailyKPIs(supervisorKey, techId, d);
// //         availableHours += k.available_hours || 0;
// //         if (k.is_absence_day) continue;

// //         // raw components only (no percent->hours reverse conversion)
// //         utilizedHours += (k.total_productive_hours || 0) + (k.total_non_productive_hours || 0) + (k.total_idle_hours || 0);

// //         productiveHours += k.total_productive_hours || 0;
// //         nonProductiveHours += k.total_non_productive_hours || 0;
// //         idleHours += k.total_idle_hours || 0;
// //       }

// //       const utilization_percent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;
// //       const productive_percent = availableHours > 0 ? (productiveHours / availableHours) * 100 : 0;
// //       const non_productive_percent = availableHours > 0 ? (nonProductiveHours / availableHours) * 100 : 0;
// //       const idle_percent = availableHours > 0 ? (idleHours / availableHours) * 100 : 0;

// //       return {
// //         date: _toYMD(d),
// //         utilization_percent: _round(Math.min(100, Math.max(0, utilization_percent))),
// //         productive_percent: _round(productive_percent),
// //         non_productive_percent: _round(non_productive_percent),
// //         idle_percent: _round(idle_percent)
// //       };
// //     };

// //     if (trendType === 'utilization') {
// //       const series = [];
// //       for (const d of days) {
// //         const dow = new Date(d).getDay();
// //         if (dow === 0 || dow === 6) continue;
// //         series.push(await aggregateForDay(d));
// //       }
// //       return series;
// //     }

// //     if (trendType === 'productivity') {
// //       // weekly aggregation: productive_percent by week_start
// //       const map = new Map();
// //       for (const d of days) {
// //         const dow = new Date(d).getDay();
// //         if (dow === 0 || dow === 6) continue;

// //         const weekStart = _toYMD(_mondayStart(d));
// //         const agg = await aggregateForDay(d);

// //         if (!map.has(weekStart)) map.set(weekStart, { week_start: weekStart, productiveHours: 0, availableHours: 0 });
// //         // Convert percent back to hours proportionally using availableHours from day agg's denominators.
// //         // We don't have the raw hours here, so recompute with daily engine outputs for correctness.
// //         // To keep single-source-of-truth, we re-run per technician for that day to sum hours.

// //         let availableHours = 0;
// //         let productiveHours = 0;
// //         for (const techId of technicianIds) {
// //           const k = await this.calculateDailyKPIs(supervisorKey, techId, d);
// //           availableHours += k.available_hours || 0;
// //           if (k.is_absence_day) continue;
// //           productiveHours += k.total_productive_hours || 0;
// //         }

// //         const entry = map.get(weekStart);
// //         entry.availableHours += availableHours;
// //         entry.productiveHours += productiveHours;
// //       }

// //       return Array.from(map.values()).map(x => ({
// //         week_start: x.week_start,
// //         productivity_percent: _round(x.availableHours > 0 ? (x.productiveHours / x.availableHours) * 100 : 0)
// //       }));
// //     }

// //     if (trendType === 'efficiency') {
// //       // Job-level efficiency trend not defined in legacy routes; return empty array
// //       return [];
// //     }

// //     if (trendType === 'overtime') {
// //       const overtimeLogs = await OvertimeLog.find({
// //         supervisor_key: supervisorKey,
// //         date: { $gte: startDate, $lte: endDate }
// //       }).sort({ date: 1 });

// //       const grouped = new Map();
// //       for (const log of overtimeLogs) {
// //         const weekStart = _toYMD(_mondayStart(log.date));
// //         if (!grouped.has(weekStart)) grouped.set(weekStart, { week_start: weekStart, hours: 0, payable: 0, count: 0 });
// //         const g = grouped.get(weekStart);
// //         g.hours += log.overtime_hours || 0;
// //         g.payable += log.payable_hours || 0;
// //         g.count += 1;
// //       }

// //       return Array.from(grouped.values()).map(g => ({
// //         week_start: g.week_start,
// //         total_overtime_hours: _round(g.hours),
// //         total_payable_hours: _round(g.payable),
// //         log_count: g.count
// //       }));
// //     }

// //     return [];
// //   }

// //   // -------------------------------
// //   // Reports (engine computed)
// //   // -------------------------------
// //   static async calculateJobCompletionReport(supervisorKey, jobId) {
// //     const job = await Job.findById(jobId).populate('technicians.technician_id', 'name employee_id');
// //     if (!job || job.supervisor_key !== supervisorKey) throw new Error('Job not found');
// //     if (job.status !== 'completed') throw new Error('Job must be completed to generate report');

// //     const efficiency_percent = job.allocated_hours > 0
// //       ? _round((job.consumed_hours / job.allocated_hours) * 100)
// //       : 0;

// //     const overtimeLogs = await OvertimeLog.find({ supervisor_key: supervisorKey, job_id: jobId });
// //     const totalOvertimeHours = overtimeLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);
// //     const totalPayableHours = overtimeLogs.reduce((sum, l) => sum + (l.payable_hours || 0), 0);

// //     const technicianDetails = (job.technicians || []).map(tech => ({
// //       technician_id: tech.technician_id._id,
// //       technician_name: tech.technician_id.name,
// //       employee_id: tech.technician_id.employee_id,
// //       allocated_hours: tech.allocated_hours,
// //       consumed_hours: tech.consumed_hours,
// //       efficiency_percent: tech.allocated_hours > 0 ? _round((tech.consumed_hours / tech.allocated_hours) * 100) : 0
// //     }));

// //     // Best-effort mapping: job schema fields may differ.
// //     const productiveHours = job.productive_hours_total || job.produced_hours_total || 0;
// //     const nonProductiveHours = job.non_productive_hours_total || 0;
// //     const downtimeHours = job.downtime_hours_total || 0;

// //     return {
// //       report_type: 'job_completion',
// //       generated_at: new Date(),
// //       job_details: {
// //         job_id: job._id,
// //         job_number: job.job_number,
// //         description: job.description,
// //         complexity_category: job.complexity_category,
// //         status: job.status,
// //         start_date: job.start_date,
// //         target_completion_date: job.target_completion_date,
// //         actual_completion_date: job.actual_completion_date
// //       },
// //       hours_breakdown: {
// //         allocated_hours: job.allocated_hours,
// //         consumed_hours: job.consumed_hours,
// //         remaining_hours: Math.max(0, (job.allocated_hours || 0) - (job.consumed_hours || 0)),
// //         overrun_hours: Math.max(0, (job.consumed_hours || 0) - (job.allocated_hours || 0)),
// //         productive_hours: _round(productiveHours),
// //         non_productive_hours: _round(nonProductiveHours),
// //         downtime_hours: _round(downtimeHours),
// //         overtime_hours: _round(totalOvertimeHours),
// //         payable_overtime_hours: _round(totalPayableHours)
// //       },
// //       performance_metrics: {
// //         efficiency_percent,
// //         completion_status: efficiency_percent > 100 ? 'OVERRUN' : efficiency_percent < 100 ? 'UNDERUTILIZED' : 'ON_TRACK',
// //         days_to_complete: job.actual_completion_date && job.start_date
// //           ? Math.ceil((new Date(job.actual_completion_date) - new Date(job.start_date)) / (1000 * 60 * 60 * 24))
// //           : 0,
// //         met_target_date: job.actual_completion_date && job.target_completion_date
// //           ? new Date(job.actual_completion_date) <= new Date(job.target_completion_date)
// //           : null
// //       },
// //       technician_details: technicianDetails,
// //       progress: {
// //         percentage: job.progress_percentage,
// //         subtasks_total: job.subtasks?.length || 0,
// //         subtasks_completed: job.subtasks?.filter(s => s.progress_by_technician?.some(p => p.completed))?.length || 0
// //       }
// //     };
// //   }

// //   static async calculateTechnicianPerformanceReport(supervisorKey, technicianId, { start_date, end_date } = {}) {
// //     const startDate = start_date ? new Date(start_date) : new Date(new Date().setMonth(new Date().getMonth() - 1));
// //     const endDate = end_date ? new Date(end_date) : new Date();

// //     const absenceRecords = await AttendanceRecord.find({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       status: 'approved',
// //       attendance_type: { $in: ['leave', 'sick'] },
// //       date: { $gte: startDate, $lte: endDate }
// //     }).select({ technician_id: 1, date: 1, attendance_type: 1 });

// //     const absenceDays = new Set(absenceRecords.map(r => `${r.technician_id}_${new Date(r.date).toDateString()}`));

// //     const dayEntriesAll = await DayEntry.find({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       date: { $gte: startDate, $lte: endDate }
// //     });

// //     const dayEntries = dayEntriesAll.filter(e => {
// //       const dayKey = `${e.technician_id}_${new Date(e.date).toDateString()}`;
// //       return !absenceDays.has(dayKey);
// //     });

// //     if (dayEntries.length === 0) {
// //       return {
// //         report_type: 'technician_performance',
// //         generated_at: new Date(),
// //         period: { start: startDate, end: endDate },
// //         technician_id: technicianId,
// //         message: 'No working data available for this period'
// //       };
// //     }

// //     const trainingLogs = await TrainingLog.find({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       training_date: { $gte: startDate, $lte: endDate }
// //     });

// //     const downtimeLogs = await DowntimeLog.find({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       date: { $gte: startDate, $lte: endDate }
// //     });

// //     const overtimeLogs = await OvertimeLog.find({
// //       supervisor_key: supervisorKey,
// //       technician_id: technicianId,
// //       date: { $gte: startDate, $lte: endDate }
// //     });

// //     let totals = {
// //       working_days: dayEntries.length,
// //       total_productive: 0,
// //       total_non_productive: 0,
// //       total_idle: 0,
// //       total_downtime: 0,
// //       total_leave: 0,
// //       total_scheduled: 0,
// //       total_overtime: 0
// //     };

// //     dayEntries.forEach(entry => {
// //       totals.total_productive += entry.total_productive_hours || 0;
// //       totals.total_non_productive += entry.total_non_productive_hours || 0;
// //       totals.total_idle += entry.total_idle_hours || 0;
// //       totals.total_downtime += entry.total_downtime_hours || 0;
// //       totals.total_leave += entry.leave_hours || 0;
// //       totals.total_scheduled += entry.scheduled_hours || 0;
// //     });

// //     totals.total_overtime = overtimeLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);

// //     const availableHours = Math.max(0, totals.total_scheduled - totals.total_leave);

// //     const reportKpis = await this.calculateTechnicianKPIsForRange(supervisorKey, technicianId, startDate, endDate);

// //     return {
// //       report_type: 'technician_performance',
// //       generated_at: new Date(),
// //       period: { start: startDate, end: endDate },
// //       technician_id: technicianId,
// //       hours_summary: {
// //         total_scheduled: _round(totals.total_scheduled),
// //         total_productive: _round(totals.total_productive),
// //         total_non_productive: _round(totals.total_non_productive),
// //         total_idle: _round(totals.total_idle),
// //         total_downtime: _round(totals.total_downtime),
// //         total_leave: _round(totals.total_leave),
// //         total_overtime: _round(totals.total_overtime),
// //         available_hours: _round(availableHours)
// //       },
// //       absence_tracking: {
// //         absence_days: dayEntriesAll.filter(e => e.is_leave_day || e.is_sick_day).length,
// //         working_days: totals.working_days
// //       },
// //       kpis: reportKpis,
// //       activity_summary: {
// //         working_days: totals.working_days,
// //         training_sessions: trainingLogs.length,
// //         training_hours: _round(trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0)),
// //         downtime_incidents: downtimeLogs.length,
// //         total_downtime_hours: _round(downtimeLogs.reduce((sum, l) => sum + (l.total_downtime_hours || 0), 0))
// //       },
// //       training_details: trainingLogs.map(log => ({
// //         title: log.training_title,
// //         date: log.training_date,
// //         hours: log.hours_spent,
// //         category: log.training_category,
// //         competency_achieved: log.competency_achieved
// //       }))
// //     };
// //   }

// //   static async calculateSupervisorPerformanceSummary(supervisorKey, { start_date, end_date } = {}) {
// //     const startDate = start_date ? new Date(start_date) : new Date(new Date().setMonth(new Date().getMonth() - 1));
// //     const endDate = end_date ? new Date(end_date) : new Date();

// //     const reportKpis = await this.calculateSupervisorKPIsForRange(supervisorKey, startDate, endDate);

// //     const absenceRecords = await AttendanceRecord.find({
// //       supervisor_key: supervisorKey,
// //       status: 'approved',
// //       attendance_type: { $in: ['leave', 'sick'] },
// //       date: { $gte: startDate, $lte: endDate }
// //     }).select({ technician_id: 1, date: 1 });

// //     const absenceDays = new Set(absenceRecords.map(r => `${r.technician_id}_${new Date(r.date).toDateString()}`));

// //     const dayEntriesAll = await DayEntry.find({
// //       supervisor_key: supervisorKey,
// //       date: { $gte: startDate, $lte: endDate }
// //     });

// //     const dayEntries = dayEntriesAll.filter(e => {
// //       const dayKey = `${e.technician_id}_${new Date(e.date).toDateString()}`;
// //       return !absenceDays.has(dayKey);
// //     });

// //     const completedJobs = await Job.find({
// //       supervisor_key: supervisorKey,
// //       status: 'completed',
// //       actual_completion_date: { $gte: startDate, $lte: endDate }
// //     });

// //     const totalTechnicians = new Set(dayEntries.map(e => e.technician_id.toString()));

// //     const totals = dayEntries.reduce(
// //       (acc, e) => {
// //         acc.total_productive += e.total_productive_hours || 0;
// //         acc.total_non_productive += e.total_non_productive_hours || 0;
// //         acc.total_idle += e.total_idle_hours || 0;
// //         acc.total_downtime += e.total_downtime_hours || 0;
// //         acc.total_scheduled += e.scheduled_hours || 0;
// //         acc.total_leave += e.leave_hours || 0;
// //         return acc;
// //       },
// //       { total_productive: 0, total_non_productive: 0, total_idle: 0, total_downtime: 0, total_scheduled: 0, total_leave: 0 }
// //     );

// //     const overtimeLogs = await OvertimeLog.find({
// //       supervisor_key: supervisorKey,
// //       date: { $gte: startDate, $lte: endDate }
// //     });

// //     const total_overtime = overtimeLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);

// //     const allTimeUsed = totals.total_productive + totals.total_non_productive + totals.total_idle;

// //     const jobMetrics = completedJobs.reduce(
// //       (acc, job) => {
// //         acc.totalJobAllocated += job.allocated_hours || 0;
// //         acc.totalJobConsumed += job.consumed_hours || 0;
// //         if (job.actual_completion_date && job.target_completion_date && new Date(job.actual_completion_date) <= new Date(job.target_completion_date)) {
// //           acc.onTimeJobs += 1;
// //         }
// //         return acc;
// //       },
// //       { totalJobAllocated: 0, totalJobConsumed: 0, onTimeJobs: 0 }
// //     );

// //     return {
// //       report_type: 'supervisor_summary',
// //       generated_at: new Date(),
// //       period: { start: startDate, end: endDate },
// //       team_metrics: {
// //         total_technicians: totalTechnicians.size,
// //         working_days: dayEntries.length,
// //         total_hours_scheduled: _round(totals.total_scheduled),
// //         total_hours_used: _round(allTimeUsed)
// //       },
// //       hours_breakdown: {
// //         total_productive: _round(totals.total_productive),
// //         total_non_productive: _round(totals.total_non_productive),
// //         total_idle: _round(totals.total_idle),
// //         total_downtime: _round(totals.total_downtime),
// //         total_leave: _round(totals.total_leave),
// //         total_overtime: _round(total_overtime)
// //       },
// //       kpis: reportKpis,
// //       job_metrics: {
// //         total_completed_jobs: completedJobs.length,
// //         total_allocated_hours: _round(jobMetrics.totalJobAllocated),
// //         total_consumed_hours: _round(jobMetrics.totalJobConsumed),
// //         on_time_jobs: jobMetrics.onTimeJobs,
// //         on_time_percent: completedJobs.length > 0 ? _round((jobMetrics.onTimeJobs / completedJobs.length) * 100) : 0,
// //         average_job_efficiency: jobMetrics.totalJobAllocated > 0 ? _round((jobMetrics.totalJobConsumed / jobMetrics.totalJobAllocated) * 100) : 0
// //       }
// //     };
// //   }
// // }

// // module.exports = KPICalculator;











// /**
//  * Central KPI Calculator Engine (Single Source of Truth)
//  *
//  * RULES ENFORCED:
//  * - ALL KPI math originates from calculateDailyKPIs ONLY
//  * - NO reverse conversion of utilization_percent → hours
//  * - NO clamping (ever)
//  * - NO TrainingLog recalculation in aggregates
//  * - NO double counting across dashboard/supervisor/weekly/monthly
//  */

// const DayEntry = require('../models/DayEntry');
// const TrainingLog = require('../models/TrainingLog');
// const OvertimeLog = require('../models/OvertimeLog');
// const DowntimeLog = require('../models/DowntimeLog');
// const Job = require('../models/Job');
// const AttendanceRecord = require('../models/AttendanceRecord');

// const SYSTEM_ALLOCATED = {
//   meetingMinutes: 15,
//   teaBreakMinutes: 15,
//   lunchMinutes: 30,
//   housekeepingMinutes: 30
// };

// const MINUTES_TO_HOURS = 1 / 60;

// const AVAILABLE_PRODUCTIVE_HOURS = {
//   weekday: 7,
//   friday: 5.5
// };

// const AVAILABLE_HOURS = {
//   weekday: 8.5,
//   friday: 7
// };

// // ---------------- helpers ----------------
// function _round(v) {
//   return parseFloat((v || 0).toFixed(2));
// }

// function _isFriday(date) {
//   return new Date(date).getDay() === 5;
// }

// function _getAvailableHours(date) {
//   return _isFriday(date) ? AVAILABLE_HOURS.friday : AVAILABLE_HOURS.weekday;
// }

// function _getAvailableProductiveHours(date) {
//   return _isFriday(date)
//     ? AVAILABLE_PRODUCTIVE_HOURS.friday
//     : AVAILABLE_PRODUCTIVE_HOURS.weekday;
// }

// function _midday(date) {
//   const d = new Date(date);
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// function _toYMD(date) {
//   const d = new Date(date);
//   d.setHours(0, 0, 0, 0);
//   return d.toISOString().split('T')[0];
// }

// function _mondayStart(date) {
//   const d = new Date(date);
//   const dow = d.getDay();
//   const diff = (dow === 0 ? -6 : 1) - dow;
//   d.setDate(d.getDate() + diff);
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// // ---------------- DAILY KPI (SOURCE OF TRUTH) ----------------
// class KPICalculator {
//   static async calculateDailyKPIs(supervisorKey, technicianId, date) {
//     const day = _midday(date);

//     const entry = await DayEntry.findOne({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       date: day
//     });

//     if (!entry) return this._empty(day);

//     const absence = await AttendanceRecord.isAbsenceDay(
//       supervisorKey,
//       technicianId,
//       day
//     );

//     if (absence) {
//       return {
//         date: day,
//         scheduled_hours: entry.scheduled_hours,
//         leave_hours: entry.leave_hours || 0,
//         available_hours: 0,
//         total_productive_hours: 0,
//         total_non_productive_hours: 0,
//         total_idle_hours: 0,
//         total_training_hours: 0,
//         is_absence_day: true,
//         kpis: {
//           utilization_percent: 0,
//           productivity_percent: 0
//         }
//       };
//     }

//     const availableHours = _getAvailableHours(day);
//     const availableProductiveHours = _getAvailableProductiveHours(day);

//     const productive = entry.total_productive_hours || 0;
//     const nonProductive = entry.total_non_productive_hours || 0;
//     const idle = entry.total_idle_hours || 0;

//     const trainingLogs = await TrainingLog.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       training_date: {
//         $gte: day,
//         $lte: new Date(day.getTime() + 86400000 - 1)
//       }
//     });

//     const training = trainingLogs.reduce(
//       (s, l) => s + (l.hours_spent || 0),
//       0
//     );

//     const utilized =
//       productive + nonProductive + idle + training;

//     const utilization =
//       availableHours > 0 ? (utilized / availableHours) * 100 : 0;

//     const productivity =
//       availableProductiveHours > 0
//         ? (productive / availableProductiveHours) * 100
//         : 0;

//     return {
//       date: day,
//       scheduled_hours: entry.scheduled_hours,
//       leave_hours: 0,
//       available_hours: availableHours,
//       total_productive_hours: productive,
//       total_non_productive_hours: nonProductive,
//       total_idle_hours: idle,
//       total_training_hours: training,
//       is_absence_day: false,
//       kpis: {
//         utilization_percent: _round(utilization),
//         productivity_percent: _round(productivity),
//         availability_percent: 100
//       }
//     };
//   }

//   static _empty(day) {
//     return {
//       date: day,
//       scheduled_hours: 0,
//       leave_hours: 0,
//       available_hours: 0,
//       total_productive_hours: 0,
//       total_non_productive_hours: 0,
//       total_idle_hours: 0,
//       total_training_hours: 0,
//       is_absence_day: false,
//       kpis: {
//         utilization_percent: 0,
//         productivity_percent: 0,
//         availability_percent: 0
//       }
//     };
//   }

//   // ---------------- WEEKLY ----------------
//   static async calculateWeeklyKPIs(supervisorKey, technicianId, weekNumber, year) {
//     const start = this._getWeekStartDate(year, weekNumber);
//     const end = new Date(start);
//     end.setDate(end.getDate() + 6);

//     const { eachDayOfInterval } = require("date-fns");
//     const days = eachDayOfInterval({ start, end });

//     let totalAvailable = 0;
//     let totalProductive = 0;
//     let totalNonProductive = 0;
//     let totalIdle = 0;
//     let totalTraining = 0;

//     for (const d of days) {
//       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);

//       totalAvailable += k.available_hours || 0;

//       if (k.is_absence_day) continue;

//       totalProductive += k.total_productive_hours || 0;
//       totalNonProductive += k.total_non_productive_hours || 0;
//       totalIdle += k.total_idle_hours || 0;
//       totalTraining += k.total_training_hours || 0;
//     }

//     const utilized =
//       totalProductive +
//       totalNonProductive +
//       totalIdle +
//       totalTraining;

//     return {
//       kpis: {
//         utilization_percent:
//           totalAvailable > 0 ? _round((utilized / totalAvailable) * 100) : 0,
//         productivity_percent:
//           totalAvailable > 0 ? _round((totalProductive / totalAvailable) * 100) : 0
//       }
//     };
//   }

//   // ---------------- MONTHLY ----------------
//   static async calculateMonthlyKPIs(supervisorKey, technicianId, month, year) {
//     const start = new Date(year, month - 1, 1);
//     const end = new Date(year, month, 0);

//     const { eachDayOfInterval } = require("date-fns");
//     const days = eachDayOfInterval({ start, end });

//     let totalAvailable = 0;
//     let totalProductive = 0;
//     let totalNonProductive = 0;
//     let totalIdle = 0;
//     let totalTraining = 0;

//     for (const d of days) {
//       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);

//       totalAvailable += k.available_hours || 0;

//       if (k.is_absence_day) continue;

//       totalProductive += k.total_productive_hours || 0;
//       totalNonProductive += k.total_non_productive_hours || 0;
//       totalIdle += k.total_idle_hours || 0;
//       totalTraining += k.total_training_hours || 0;
//     }

//     const utilized =
//       totalProductive +
//       totalNonProductive +
//       totalIdle +
//       totalTraining;

//     return {
//       kpis: {
//         utilization_percent:
//           totalAvailable > 0 ? _round((utilized / totalAvailable) * 100) : 0
//       }
//     };
//   }

//   // ---------------- DASHBOARD ----------------
//   static async calculateDashboardKPIs(supervisorKey, from, to) {
//     const { eachDayOfInterval } = require("date-fns");
//     const days = eachDayOfInterval({
//       start: new Date(from),
//       end: new Date(to)
//     });

//     const entries = await DayEntry.find({
//       supervisor_key: supervisorKey,
//       date: { $gte: new Date(from), $lte: new Date(to) }
//     });

//     const techs = new Set(entries.map(e => e.technician_id.toString()));

//     let totalAvailable = 0;
//     let totalUtilized = 0;

//     for (const tech of techs) {
//       for (const d of days) {
//         const k = await this.calculateDailyKPIs(supervisorKey, tech, d);

//         totalAvailable += k.available_hours || 0;

//         if (k.is_absence_day) continue;

//         totalUtilized +=
//           (k.total_productive_hours || 0) +
//           (k.total_non_productive_hours || 0) +
//           (k.total_idle_hours || 0) +
//           (k.total_training_hours || 0);
//       }
//     }

//     return {
//       kpis: {
//         utilization_percent:
//           totalAvailable > 0
//             ? _round((totalUtilized / totalAvailable) * 100)
//             : 0
//       }
//     };
//   }

//   // ---------------- WEEK START ----------------
//   static _getWeekStartDate(year, week) {
//     const first = new Date(year, 0, 1);
//     const dow = first.getDay() || 7;
//     const offset = 1 - dow;
//     const firstMonday = new Date(year, 0, 1 + offset);

//     const d = new Date(firstMonday);
//     d.setDate(firstMonday.getDate() + (week - 1) * 7);
//     return d;
//   }
// }

// module.exports = KPICalculator;





// /**
//  * Central KPI Calculator Engine (Single Source of Truth)
//  *
//  * IMPORTANT (architecture):
//  * - No KPI math in routes. All KPI calculations live here.
//  * - No TimeLog-based KPI calculations in this engine.
//  * - Leave/Sick exclusion is driven ONLY by AttendanceRecord.status === 'approved'.
//  * - Overtime + Downtime are excluded from Productivity and Utilization.
//  */

// const DayEntry = require('../models/DayEntry');
// const TrainingLog = require('../models/TrainingLog');
// const OvertimeLog = require('../models/OvertimeLog');
// const DowntimeLog = require('../models/DowntimeLog');
// const Job = require('../models/Job');
// const AttendanceRecord = require('../models/AttendanceRecord');

// // Note: WeekEntry/OvertimeLog are not used by daily utilization formulas directly.
// // WeekEntry remains in data model, but KPI aggregation is recomputed from DayEntry.

// // Business rule configuration (NOT hardcoded in formulas)
// const SYSTEM_ALLOCATED = {
//   meetingMinutes: 15,
//   teaBreakMinutes: 15,
//   lunchMinutes: 30,
//   housekeepingMinutes: 30
// };

// const MINUTES_TO_HOURS = 1 / 60;

// // Fixed denominators by day-of-week
// // (Used to compute Availability/Productivity/Utilization)
// const AVAILABLE_PRODUCTIVE_HOURS = {
//   weekday: 7, // Mon-Thu
//   friday: 5.5
// };

// const AVAILABLE_HOURS = {
//   weekday: 8.5, // Mon-Thu
//   friday: 7
// };

// function _round(value) {
//   return parseFloat((value || 0).toFixed(2));
// }

// function _isFriday(date) {
//   return new Date(date).getDay() === 5;
// }

// function _getAvailableProductiveHours(date) {
//   return _isFriday(date) ? AVAILABLE_PRODUCTIVE_HOURS.friday : AVAILABLE_PRODUCTIVE_HOURS.weekday;
// }

// function _getAvailableHours(date) {
//   return _isFriday(date) ? AVAILABLE_HOURS.friday : AVAILABLE_HOURS.weekday;
// }

// function _systemAllocatedUtilizationHours() {
//   const totalMinutes =
//     SYSTEM_ALLOCATED.meetingMinutes +
//     SYSTEM_ALLOCATED.teaBreakMinutes +
//     SYSTEM_ALLOCATED.lunchMinutes +
//     SYSTEM_ALLOCATED.housekeepingMinutes;

//   return totalMinutes * MINUTES_TO_HOURS;
// }

// async function _getApprovedAbsenceHoursByDate(supervisorKey, technicianId, date) {
//   const isApprovedAbsence = await AttendanceRecord.isAbsenceDay(supervisorKey, technicianId, date);
//   if (!isApprovedAbsence) return 0;
//   const details = await AttendanceRecord.getAbsenceDetails(supervisorKey, technicianId, date);
//   return details?.hours || 0;
// }

// function _getDayFromMidday(date) {
//   const d = new Date(date);
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// function _toYMD(date) {
//   const d = new Date(date);
//   d.setHours(0, 0, 0, 0);
//   return d.toISOString().split('T')[0];
// }

// function _mondayStart(date) {
//   const d = new Date(date);
//   const dow = d.getDay(); // 0=Sun..6=Sat
//   // shift so Monday is start
//   const diff = (dow === 0 ? -6 : 1) - dow;
//   d.setDate(d.getDate() + diff);
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// class KPICalculator {
//   // -------------------------------
//   // Single-day KPI engine
//   // -------------------------------
//   static async calculateDailyKPIs(supervisorKey, technicianId, date) {
//     const day = _getDayFromMidday(date);

//     const dayEntry = await DayEntry.findOne({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       date: day
//     });

//     if (!dayEntry) return this._emptyDayKpis(day);

//     const approvedAbsenceHours = await _getApprovedAbsenceHoursByDate(supervisorKey, technicianId, day);
//     if (approvedAbsenceHours > 0) {
//       return {
//         date: day,
//         scheduled_hours: dayEntry.scheduled_hours,
//         leave_hours: approvedAbsenceHours,
//         available_hours: 0,
//         total_productive_hours: 0,
//         total_non_productive_hours: 0,
//         total_idle_hours: 0,
//         total_overtime_hours: 0,
//         total_downtime_hours: 0,
//         is_absence_day: true,
//         absence_type: dayEntry.is_leave_day ? 'leave' : 'sick',
//         kpis: {
//           availability_percent: 0,
//           productive_percent: 0,
//           non_productive_percent: 0,
//           idle_percent: 0,
//           utilization_percent: 0,
//           productivity_percent: 0,
//           efficiency_percent: 0
//         },
//         entry_id: dayEntry._id
//       };
//     }

//     const availableProductiveHours = _getAvailableProductiveHours(day);
//     const availableHours = _getAvailableHours(day);

//     const productiveHours = dayEntry.total_productive_hours || 0;
//     const nonProductiveHours = dayEntry.total_non_productive_hours || 0;
//     const idleHours = dayEntry.total_idle_hours || 0;

//     const trainingLogs = await TrainingLog.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       training_date: { $gte: day, $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1) }
//     });

//     const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);

//     // Utilization numerator (single source of truth):
//     // utilization hours = productive + training + non-productive + idle
//     // NOTE: do NOT clamp here; clamping breaks correctness and hides KPI engine issues.
//     const utilizedHours = productiveHours + trainingHours + nonProductiveHours + idleHours;

//     const productivityPercent = availableProductiveHours > 0 ? (productiveHours / availableProductiveHours) * 100 : 0;
//     const utilizationPercent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;


//     const availabilityPercent = availableHours > 0 ? 100 : 0;
//     const idlePercent = availableHours > 0 ? (idleHours / availableHours) * 100 : 0;
//     const nonProductivePercent = availableHours > 0 ? (nonProductiveHours / availableHours) * 100 : 0;

//     return {
//       date: day,
//       scheduled_hours: dayEntry.scheduled_hours,
//       leave_hours: 0,
//       available_hours: availableHours,
//       total_productive_hours: productiveHours,
//       total_non_productive_hours: nonProductiveHours,
//       total_idle_hours: idleHours,
//       total_overtime_hours: 0,
//       total_downtime_hours: 0,
//       is_absence_day: false,
//       kpis: {
//         availability_percent: _round(availabilityPercent),
//         productive_percent: _round(productiveHours > 0 ? productivityPercent : productivityPercent),
//         non_productive_percent: _round(nonProductivePercent),
//         idle_percent: _round(idlePercent),
//         utilization_percent: _round(utilizationPercent),

//         productivity_percent: _round(productivityPercent),
//         efficiency_percent: 0
//       },
//       entry_id: dayEntry._id
//     };
//   }

//   static _emptyDayKpis(day) {
//     return {
//       date: day,
//       scheduled_hours: 0,
//       leave_hours: 0,
//       available_hours: 0,
//       total_productive_hours: 0,
//       total_non_productive_hours: 0,
//       total_idle_hours: 0,
//       total_overtime_hours: 0,
//       total_downtime_hours: 0,
//       is_absence_day: false,
//       kpis: {
//         availability_percent: 0,
//         productive_percent: 0,
//         non_productive_percent: 0,
//         idle_percent: 0,
//         utilization_percent: 0,
//         productivity_percent: 0,
//         efficiency_percent: 0
//       },
//       entry_id: null
//     };
//   }

//   // -------------------------------
//   // Weekly / Monthly / Dashboard KPI aggregation
//   // -------------------------------
//   static async calculateWeeklyKPIs(supervisorKey, technicianId, weekNumber, year) {
//     const startDate = this._getWeekStartDate(year, weekNumber);
//     const endDate = new Date(startDate);
//     // inclusive interval: 7 days
//     endDate.setDate(endDate.getDate() + 6);


//     const { eachDayOfInterval } = require('date-fns');
//     const days = eachDayOfInterval({ start: startDate, end: endDate });

//     let totalProductiveHours = 0;
//     let totalNonProductiveHours = 0;
//     let totalIdleHours = 0;
//     let totalTrainingHours = 0;
//     let totalAvailableHours = 0;
//     let totalAvailableProductiveHours = 0;

//     for (const d of days) {
//       const day = _getDayFromMidday(d);
//       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, day);
//       totalAvailableProductiveHours += _getAvailableProductiveHours(day);
//       totalAvailableHours += _getAvailableHours(day);

//       if (k.is_absence_day) continue;

//       totalProductiveHours += k.total_productive_hours || 0;
//       totalNonProductiveHours += k.total_non_productive_hours || 0;
//       totalIdleHours += k.total_idle_hours || 0;

//       const trainingLogs = await TrainingLog.find({
//         supervisor_key: supervisorKey,
//         technician_id: technicianId,
//         training_date: {
//           $gte: day,
//           $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)
//         }
//       });
//       const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
//       totalTrainingHours += trainingHours;
//     }

//     const utilizedHoursTotal =
//       totalProductiveHours +
//       totalTrainingHours +
//       totalNonProductiveHours +
//       totalIdleHours;

//     const utilizationPercent = totalAvailableHours > 0 ? (utilizedHoursTotal / totalAvailableHours) * 100 : 0;
//     const productivityPercent = totalAvailableProductiveHours > 0 ? (totalProductiveHours / totalAvailableProductiveHours) * 100 : 0;

//     return {
//       week: weekNumber,
//       year,
//       scheduled_hours: null,
//       leave_hours: null,
//       available_hours: totalAvailableHours,
//       total_productive_hours: totalProductiveHours,
//       total_non_productive_hours: totalNonProductiveHours,
//       total_idle_hours: totalIdleHours,
//       total_overtime_hours: 0,
//       total_downtime_hours: 0,
//       kpis: {
//         availability_percent: totalAvailableHours > 0 ? 100 : 0,
//         productive_percent: _round((totalProductiveHours / totalAvailableProductiveHours) * 100),
//         non_productive_percent: totalAvailableHours > 0 ? _round((totalNonProductiveHours / totalAvailableHours) * 100) : 0,
//         idle_percent: totalAvailableHours > 0 ? _round((totalIdleHours / totalAvailableHours) * 100) : 0,
//         utilization_percent: _round(utilizationPercent),
//         productivity_percent: _round(productivityPercent),
//         efficiency_percent: 0
//       },
//       entry_id: null
//     };
//   }

//   static async calculateMonthlyKPIs(supervisorKey, technicianId, month, year) {
//     const monthNum = parseInt(month);
//     const yearNum = parseInt(year);

//     const startDate = new Date(yearNum, monthNum - 1, 1);
//     const endDate = new Date(yearNum, monthNum, 0);

//     const { eachDayOfInterval } = require('date-fns');
//     const days = eachDayOfInterval({ start: startDate, end: endDate });

//     let totalProductiveHours = 0;
//     let totalNonProductiveHours = 0;
//     let totalIdleHours = 0;
//     let totalTrainingHours = 0;
//     let totalAvailableHours = 0;
//     let totalAvailableProductiveHours = 0;

//     for (const d of days) {
//       const dow = new Date(d).getDay();
//       if (dow === 0 || dow === 6) continue;

//       totalAvailableProductiveHours += _getAvailableProductiveHours(d);
//       totalAvailableHours += _getAvailableHours(d);

//       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);
//       if (k.is_absence_day) continue;

//       totalProductiveHours += k.total_productive_hours || 0;
//       totalNonProductiveHours += k.total_non_productive_hours || 0;
//       totalIdleHours += k.total_idle_hours || 0;

//       const trainingLogs = await TrainingLog.find({
//         supervisor_key: supervisorKey,
//         technician_id: technicianId,
//         training_date: { $gte: _getDayFromMidday(d), $lte: new Date(new Date(d).getTime() + 24 * 60 * 60 * 1000 - 1) }
//       });
//       const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
//       totalTrainingHours += trainingHours;

//     }

//     const utilizedHoursTotal =
//       totalProductiveHours +
//       totalTrainingHours +
//       totalNonProductiveHours +
//       totalIdleHours;

//     const utilizationPercent = totalAvailableHours > 0 ? (utilizedHoursTotal / totalAvailableHours) * 100 : 0;
//     const productivityPercent = totalAvailableProductiveHours > 0 ? (totalProductiveHours / totalAvailableProductiveHours) * 100 : 0;

//     return {
//       period: 'monthly',
//       month: monthNum,
//       year: yearNum,
//       working_days: null,
//       hours: {
//         total_scheduled: null,
//         total_leave: null,
//         total_productive: totalProductiveHours,
//         total_non_productive: totalNonProductiveHours,
//         total_idle: totalIdleHours,
//         total_overtime: 0,
//         total_downtime: 0,
//         available_hours: totalAvailableHours
//       },
//       kpis: {
//         availability_percent: totalAvailableHours > 0 ? 100 : 0,
//         productive_percent: totalAvailableProductiveHours > 0 ? _round((totalProductiveHours / totalAvailableProductiveHours) * 100) : 0,
//         non_productive_percent: totalAvailableHours > 0 ? _round((totalNonProductiveHours / totalAvailableHours) * 100) : 0,
//         idle_percent: totalAvailableHours > 0 ? _round((totalIdleHours / totalAvailableHours) * 100) : 0,
//         utilization_percent: _round(utilizationPercent),
//         productivity_percent: _round(productivityPercent),
//         efficiency_percent: 0
//       }
//     };
//   }

//   static async calculateDashboardKPIs(supervisorKey, dateFrom, dateTo) {
//     const { eachDayOfInterval } = require('date-fns');
//     const days = eachDayOfInterval({ start: new Date(dateFrom), end: new Date(dateTo) });

//     const dayEntries = await DayEntry.find({
//       supervisor_key: supervisorKey,
//       date: { $gte: new Date(dateFrom), $lte: new Date(dateTo) }
//     });

//     const uniqueTechs = new Set(dayEntries.map(e => e.technician_id.toString()));

//     let totalAvailableHours = 0;
//     let totalUtilizedHours = 0;
//     let totalProductiveHours = 0;
//     let totalNonProductiveHours = 0;
//     let totalIdleHours = 0;

//     for (const techIdStr of uniqueTechs) {
//       const technicianId = techIdStr;
//       for (const d of days) {
//         const dow = new Date(d).getDay();
//         if (dow === 0 || dow === 6) continue;

//         const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);
//         totalAvailableHours += _getAvailableHours(d);

//         if (k.is_absence_day) continue;

//         totalProductiveHours += k.total_productive_hours || 0;
//         totalNonProductiveHours += k.total_non_productive_hours || 0;
//         totalIdleHours += k.total_idle_hours || 0;

//         const trainingLogs = await TrainingLog.find({
//           supervisor_key: supervisorKey,
//           technician_id: technicianId,
//           training_date: {
//             $gte: _getDayFromMidday(d),
//             $lte: new Date(new Date(d).getTime() + 24 * 60 * 60 * 1000 - 1)
//           }
//         });
//         const trainingHours = trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);

//         totalUtilizedHours += (k.total_productive_hours || 0) +
//           (k.total_non_productive_hours || 0) +
//           trainingHours +
//           (k.total_idle_hours || 0);

//       }
//     }

//     const utilizationPercent = totalAvailableHours > 0 ? (totalUtilizedHours / totalAvailableHours) * 100 : 0;
//     return {
//       period: { from: dateFrom, to: dateTo },
//       technicians_count: uniqueTechs.size,
//       entries_count: dayEntries.length,
//       hours: {
//         total_scheduled: null,
//         total_leave: null,
//         total_productive: _round(totalProductiveHours),
//         total_non_productive: _round(totalNonProductiveHours),
//         total_idle: _round(totalIdleHours),
//         total_overtime: 0,
//         total_downtime: 0,
//         available_hours: _round(totalAvailableHours)
//       },
//       kpis: {
//         productive_percent: totalAvailableHours > 0 ? _round((totalProductiveHours / totalAvailableHours) * 100) : 0,
//         non_productive_percent: totalAvailableHours > 0 ? _round((totalNonProductiveHours / totalAvailableHours) * 100) : 0,
//         idle_percent: totalAvailableHours > 0 ? _round((totalIdleHours / totalAvailableHours) * 100) : 0,
//         efficiency_percent: 0,
//         availability_percent: totalAvailableHours > 0 ? 100 : 0,
//         utilization_percent: _round(utilizationPercent)
//       },
//       jobs: {
//         active_jobs: 0,
//         completed_jobs: 0,
//         at_risk_jobs: 0,
//         total_jobs: 0
//       }
//     };
//   }

//   static async calculateTechnicianKPIsForRange(supervisorKey, technicianId, startDate, endDate) {
//     const { eachDayOfInterval } = require('date-fns');
//     const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

//     let totalScheduled = 0;
//     let totalLeave = 0;

//     let productiveHours = 0;
//     let nonProductiveHours = 0;
//     let idleHours = 0;
//     let trainingHours = 0;

//     for (const d of days) {
//       const day = _getDayFromMidday(d);

//       const dayEntry = await DayEntry.findOne({
//         supervisor_key: supervisorKey,
//         technician_id: technicianId,
//         date: day
//       });
//       if (!dayEntry) continue;

//       totalScheduled += dayEntry.scheduled_hours || 0;
//       totalLeave += dayEntry.leave_hours || 0;

//       const k = await this.calculateDailyKPIs(supervisorKey, technicianId, day);
//       if (k.is_absence_day) continue;

//       productiveHours += k.total_productive_hours || 0;
//       nonProductiveHours += k.total_non_productive_hours || 0;
//       idleHours += k.total_idle_hours || 0;

//       const trainingLogs = await TrainingLog.find({
//         supervisor_key: supervisorKey,
//         technician_id: technicianId,
//         training_date: {
//           $gte: day,
//           $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)
//         }
//       });
//       trainingHours += trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
//     }

//     const availableHours = Math.max(0, totalScheduled - totalLeave);

//     const utilizedHours = productiveHours + nonProductiveHours + idleHours + trainingHours;
//     const utilizationPercent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;
//     const productive_percent = availableHours > 0 ? (productiveHours / availableHours) * 100 : 0;
//     const non_productive_percent = availableHours > 0 ? (nonProductiveHours / availableHours) * 100 : 0;
//     const idle_percent = availableHours > 0 ? (idleHours / availableHours) * 100 : 0;

//     const availability_percent = totalScheduled > 0 ? (availableHours / totalScheduled) * 100 : 0;

//     return {
//       availability_percent: _round(availability_percent),
//       utilization_percent: _round(utilizationPercent),
//       productive_percent: _round(productive_percent),
//       non_productive_percent: _round(non_productive_percent),
//       idle_percent: _round(idle_percent)
//     };
//   }

//   static async calculateSupervisorKPIsForRange(supervisorKey, startDate, endDate) {
//     const { eachDayOfInterval } = require('date-fns');
//     const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

//     const dayEntries = await DayEntry.find({
//       supervisor_key: supervisorKey,
//       date: { $gte: new Date(startDate), $lte: new Date(endDate) }
//     });

//     const uniqueTechs = new Set(dayEntries.map(e => e.technician_id.toString()));

//     let totalScheduled = 0;
//     let totalLeave = 0;

//     let productiveHours = 0;
//     let nonProductiveHours = 0;
//     let idleHours = 0;
//     let trainingHours = 0;

//     for (const techId of uniqueTechs) {
//       for (const d of days) {
//         const day = _getDayFromMidday(d);

//         const dayEntry = await DayEntry.findOne({
//           supervisor_key: supervisorKey,
//           technician_id: techId,
//           date: day
//         });

//         if (!dayEntry) continue;

//         totalScheduled += dayEntry.scheduled_hours || 0;
//         totalLeave += dayEntry.leave_hours || 0;

//         const k = await this.calculateDailyKPIs(supervisorKey, techId, day);
//         if (k.is_absence_day) continue;

//         productiveHours += k.total_productive_hours || 0;

//         nonProductiveHours += k.total_non_productive_hours || 0;
//         idleHours += k.total_idle_hours || 0;

//         const trainingLogs = await TrainingLog.find({
//           supervisor_key: supervisorKey,
//           technician_id: techId,
//           training_date: {
//             $gte: day,
//             $lte: new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1)
//           }
//         });
//         trainingHours += trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0);
//       }
//     }

//     const availableHours = Math.max(0, totalScheduled - totalLeave);
//     const utilizedHours = productiveHours + nonProductiveHours + idleHours + trainingHours;
//     const utilizationPercent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;


//   static _getWeekStartDate(year, weekNumber) {
//     const firstDay = new Date(year, 0, 1);
//     const firstDayDow = firstDay.getDay() || 7; // Sunday=7
//     const offset = 1 - firstDayDow;
//     const firstMonday = new Date(year, 0, 1 + offset);
//     const weekStart = new Date(firstMonday);
//     weekStart.setDate(firstMonday.getDate() + (weekNumber - 1) * 7);
//     return weekStart;
//   }

//   // -------------------------------
//   // Trends API (Supervisor-level)
//   // -------------------------------
//   static async calculateTrendKPIs(trendType, supervisorKey, { start_date, end_date } = {}) {
//     const startDate = start_date ? new Date(start_date) : new Date(new Date().setMonth(new Date().getMonth() - 1));
//     const endDate = end_date ? new Date(end_date) : new Date();

//     const { eachDayOfInterval } = require('date-fns');
//     const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) });

//     const technicianIds = await (async () => {
//       const entries = await DayEntry.find({
//         supervisor_key: supervisorKey,
//         date: { $gte: startDate, $lte: endDate }
//       }).select({ technician_id: 1 });
//       return Array.from(new Set(entries.map(e => e.technician_id.toString())));
//     })();

//     const aggregateForDay = async (d) => {
//       let availableHours = 0;
//       let utilizedHours = 0;
//       let productiveHours = 0;
//       let nonProductiveHours = 0;
//       let idleHours = 0;

//       for (const techId of technicianIds) {
//         const k = await this.calculateDailyKPIs(supervisorKey, techId, d);
//         availableHours += k.available_hours || 0;
//         if (k.is_absence_day) continue;

//         // raw components only (no percent->hours reverse conversion)
//         utilizedHours += (k.total_productive_hours || 0) + (k.total_non_productive_hours || 0) + (k.total_idle_hours || 0);

//         productiveHours += k.total_productive_hours || 0;
//         nonProductiveHours += k.total_non_productive_hours || 0;
//         idleHours += k.total_idle_hours || 0;
//       }

//       const utilization_percent = availableHours > 0 ? (utilizedHours / availableHours) * 100 : 0;
//       const productive_percent = availableHours > 0 ? (productiveHours / availableHours) * 100 : 0;

//     const non_productive_percent = availableHours > 0 ? (nonProductiveHours / availableHours) * 100 : 0;
//       const idle_percent = availableHours > 0 ? (idleHours / availableHours) * 100 : 0;

//       return {
//         date: _toYMD(d),
//         utilization_percent: _round(Math.min(100, Math.max(0, utilization_percent))),
//         productive_percent: _round(productive_percent),
//         non_productive_percent: _round(non_productive_percent),
//         idle_percent: _round(idle_percent)
//       };
//     };

//     if (trendType === 'utilization') {
//       const series = [];
//       for (const d of days) {
//         const dow = new Date(d).getDay();
//         if (dow === 0 || dow === 6) continue;
//         series.push(await aggregateForDay(d));
//       }
//       return series;
//     }

//     if (trendType === 'productivity') {
//       // weekly aggregation: productive_percent by week_start
//       const map = new Map();
//       for (const d of days) {
//         const dow = new Date(d).getDay();
//         if (dow === 0 || dow === 6) continue;

//         const weekStart = _toYMD(_mondayStart(d));
//         const agg = await aggregateForDay(d);

//         if (!map.has(weekStart)) map.set(weekStart, { week_start: weekStart, productiveHours: 0, availableHours: 0 });
//         // Convert percent back to hours proportionally using availableHours from day agg's denominators.
//         // We don't have the raw hours here, so recompute with daily engine outputs for correctness.
//         // To keep single-source-of-truth, we re-run per technician for that day to sum hours.

//         let availableHours = 0;
//         let productiveHours = 0;
//         for (const techId of technicianIds) {
//           const k = await this.calculateDailyKPIs(supervisorKey, techId, d);
//           availableHours += k.available_hours || 0;
//           if (k.is_absence_day) continue;
//           productiveHours += k.total_productive_hours || 0;
//         }

//         const entry = map.get(weekStart);
//         entry.availableHours += availableHours;
//         entry.productiveHours += productiveHours;
//       }

//       return Array.from(map.values()).map(x => ({
//         week_start: x.week_start,
//         productivity_percent: _round(x.availableHours > 0 ? (x.productiveHours / x.availableHours) * 100 : 0)
//       }));
//     }

//     if (trendType === 'efficiency') {
//       // Job-level efficiency trend not defined in legacy routes; return empty array
//       return [];
//     }

//     if (trendType === 'overtime') {
//       const overtimeLogs = await OvertimeLog.find({
//         supervisor_key: supervisorKey,
//         date: { $gte: startDate, $lte: endDate }
//       }).sort({ date: 1 });

//       const grouped = new Map();
//       for (const log of overtimeLogs) {
//         const weekStart = _toYMD(_mondayStart(log.date));
//         if (!grouped.has(weekStart)) grouped.set(weekStart, { week_start: weekStart, hours: 0, payable: 0, count: 0 });
//         const g = grouped.get(weekStart);
//         g.hours += log.overtime_hours || 0;
//         g.payable += log.payable_hours || 0;
//         g.count += 1;
//       }

//       return Array.from(grouped.values()).map(g => ({
//         week_start: g.week_start,
//         total_overtime_hours: _round(g.hours),
//         total_payable_hours: _round(g.payable),
//         log_count: g.count
//       }));
//     }

//     return [];
//   }

//   // -------------------------------
//   // Reports (engine computed)
//   // -------------------------------
//   static async calculateJobCompletionReport(supervisorKey, jobId) {
//     const job = await Job.findById(jobId).populate('technicians.technician_id', 'name employee_id');
//     if (!job || job.supervisor_key !== supervisorKey) throw new Error('Job not found');
//     if (job.status !== 'completed') throw new Error('Job must be completed to generate report');

//     const efficiency_percent = job.allocated_hours > 0
//       ? _round((job.consumed_hours / job.allocated_hours) * 100)
//       : 0;

//     const overtimeLogs = await OvertimeLog.find({ supervisor_key: supervisorKey, job_id: jobId });
//     const totalOvertimeHours = overtimeLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);
//     const totalPayableHours = overtimeLogs.reduce((sum, l) => sum + (l.payable_hours || 0), 0);

//     const technicianDetails = (job.technicians || []).map(tech => ({
//       technician_id: tech.technician_id._id,
//       technician_name: tech.technician_id.name,
//       employee_id: tech.technician_id.employee_id,
//       allocated_hours: tech.allocated_hours,
//       consumed_hours: tech.consumed_hours,
//       efficiency_percent: tech.allocated_hours > 0 ? _round((tech.consumed_hours / tech.allocated_hours) * 100) : 0
//     }));

//     // Best-effort mapping: job schema fields may differ.
//     const productiveHours = job.productive_hours_total || job.produced_hours_total || 0;
//     const nonProductiveHours = job.non_productive_hours_total || 0;
//     const downtimeHours = job.downtime_hours_total || 0;

//     return {
//       report_type: 'job_completion',
//       generated_at: new Date(),
//       job_details: {
//         job_id: job._id,
//         job_number: job.job_number,
//         description: job.description,
//         complexity_category: job.complexity_category,
//         status: job.status,
//         start_date: job.start_date,
//         target_completion_date: job.target_completion_date,
//         actual_completion_date: job.actual_completion_date
//       },
//       hours_breakdown: {
//         allocated_hours: job.allocated_hours,
//         consumed_hours: job.consumed_hours,
//         remaining_hours: Math.max(0, (job.allocated_hours || 0) - (job.consumed_hours || 0)),
//         overrun_hours: Math.max(0, (job.consumed_hours || 0) - (job.allocated_hours || 0)),
//         productive_hours: _round(productiveHours),
//         non_productive_hours: _round(nonProductiveHours),
//         downtime_hours: _round(downtimeHours),
//         overtime_hours: _round(totalOvertimeHours),
//         payable_overtime_hours: _round(totalPayableHours)
//       },
//       performance_metrics: {
//         efficiency_percent,
//         completion_status: efficiency_percent > 100 ? 'OVERRUN' : efficiency_percent < 100 ? 'UNDERUTILIZED' : 'ON_TRACK',
//         days_to_complete: job.actual_completion_date && job.start_date
//           ? Math.ceil((new Date(job.actual_completion_date) - new Date(job.start_date)) / (1000 * 60 * 60 * 24))
//           : 0,
//         met_target_date: job.actual_completion_date && job.target_completion_date
//           ? new Date(job.actual_completion_date) <= new Date(job.target_completion_date)
//           : null
//       },
//       technician_details: technicianDetails,
//       progress: {
//         percentage: job.progress_percentage,
//         subtasks_total: job.subtasks?.length || 0,
//         subtasks_completed: job.subtasks?.filter(s => s.progress_by_technician?.some(p => p.completed))?.length || 0
//       }
//     };
//   }

//   static async calculateTechnicianPerformanceReport(supervisorKey, technicianId, { start_date, end_date } = {}) {
//     const startDate = start_date ? new Date(start_date) : new Date(new Date().setMonth(new Date().getMonth() - 1));
//     const endDate = end_date ? new Date(end_date) : new Date();

//     const absenceRecords = await AttendanceRecord.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       status: 'approved',
//       attendance_type: { $in: ['leave', 'sick'] },
//       date: { $gte: startDate, $lte: endDate }
//     }).select({ technician_id: 1, date: 1, attendance_type: 1 });

//     const absenceDays = new Set(absenceRecords.map(r => `${r.technician_id}_${new Date(r.date).toDateString()}`));

//     const dayEntriesAll = await DayEntry.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       date: { $gte: startDate, $lte: endDate }
//     });

//     const dayEntries = dayEntriesAll.filter(e => {
//       const dayKey = `${e.technician_id}_${new Date(e.date).toDateString()}`;
//       return !absenceDays.has(dayKey);
//     });

//     if (dayEntries.length === 0) {
//       return {
//         report_type: 'technician_performance',
//         generated_at: new Date(),
//         period: { start: startDate, end: endDate },
//         technician_id: technicianId,
//         message: 'No working data available for this period'
//       };
//     }

//     const trainingLogs = await TrainingLog.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       training_date: { $gte: startDate, $lte: endDate }
//     });

//     const downtimeLogs = await DowntimeLog.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       date: { $gte: startDate, $lte: endDate }
//     });

//     const overtimeLogs = await OvertimeLog.find({
//       supervisor_key: supervisorKey,
//       technician_id: technicianId,
//       date: { $gte: startDate, $lte: endDate }
//     });

//     let totals = {
//       working_days: dayEntries.length,
//       total_productive: 0,
//       total_non_productive: 0,
//       total_idle: 0,
//       total_downtime: 0,
//       total_leave: 0,
//       total_scheduled: 0,
//       total_overtime: 0
//     };

//     dayEntries.forEach(entry => {
//       totals.total_productive += entry.total_productive_hours || 0;
//       totals.total_non_productive += entry.total_non_productive_hours || 0;
//       totals.total_idle += entry.total_idle_hours || 0;
//       totals.total_downtime += entry.total_downtime_hours || 0;
//       totals.total_leave += entry.leave_hours || 0;
//       totals.total_scheduled += entry.scheduled_hours || 0;
//     });

//     totals.total_overtime = overtimeLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);

//     const availableHours = Math.max(0, totals.total_scheduled - totals.total_leave);

//     const reportKpis = await this.calculateTechnicianKPIsForRange(supervisorKey, technicianId, startDate, endDate);

//     return {
//       report_type: 'technician_performance',
//       generated_at: new Date(),
//       period: { start: startDate, end: endDate },
//       technician_id: technicianId,
//       hours_summary: {
//         total_scheduled: _round(totals.total_scheduled),
//         total_productive: _round(totals.total_productive),
//         total_non_productive: _round(totals.total_non_productive),
//         total_idle: _round(totals.total_idle),
//         total_downtime: _round(totals.total_downtime),
//         total_leave: _round(totals.total_leave),
//         total_overtime: _round(totals.total_overtime),
//         available_hours: _round(availableHours)
//       },
//       absence_tracking: {
//         absence_days: dayEntriesAll.filter(e => e.is_leave_day || e.is_sick_day).length,
//         working_days: totals.working_days
//       },
//       kpis: reportKpis,
//       activity_summary: {
//         working_days: totals.working_days,
//         training_sessions: trainingLogs.length,
//         training_hours: _round(trainingLogs.reduce((sum, l) => sum + (l.hours_spent || 0), 0)),
//         downtime_incidents: downtimeLogs.length,
//         total_downtime_hours: _round(downtimeLogs.reduce((sum, l) => sum + (l.total_downtime_hours || 0), 0))
//       },
//       training_details: trainingLogs.map(log => ({
//         title: log.training_title,
//         date: log.training_date,
//         hours: log.hours_spent,
//         category: log.training_category,
//         competency_achieved: log.competency_achieved
//       }))
//     };
//   }

//   static async calculateSupervisorPerformanceSummary(supervisorKey, { start_date, end_date } = {}) {
//     const startDate = start_date ? new Date(start_date) : new Date(new Date().setMonth(new Date().getMonth() - 1));
//     const endDate = end_date ? new Date(end_date) : new Date();

//     const reportKpis = await this.calculateSupervisorKPIsForRange(supervisorKey, startDate, endDate);

//     const absenceRecords = await AttendanceRecord.find({
//       supervisor_key: supervisorKey,
//       status: 'approved',
//       attendance_type: { $in: ['leave', 'sick'] },
//       date: { $gte: startDate, $lte: endDate }
//     }).select({ technician_id: 1, date: 1 });

//     const absenceDays = new Set(absenceRecords.map(r => `${r.technician_id}_${new Date(r.date).toDateString()}`));

//     const dayEntriesAll = await DayEntry.find({
//       supervisor_key: supervisorKey,
//       date: { $gte: startDate, $lte: endDate }
//     });

//     const dayEntries = dayEntriesAll.filter(e => {
//       const dayKey = `${e.technician_id}_${new Date(e.date).toDateString()}`;
//       return !absenceDays.has(dayKey);
//     });

//     const completedJobs = await Job.find({
//       supervisor_key: supervisorKey,
//       status: 'completed',
//       actual_completion_date: { $gte: startDate, $lte: endDate }
//     });

//     const totalTechnicians = new Set(dayEntries.map(e => e.technician_id.toString()));

//     const totals = dayEntries.reduce(
//       (acc, e) => {
//         acc.total_productive += e.total_productive_hours || 0;
//         acc.total_non_productive += e.total_non_productive_hours || 0;
//         acc.total_idle += e.total_idle_hours || 0;
//         acc.total_downtime += e.total_downtime_hours || 0;
//         acc.total_scheduled += e.scheduled_hours || 0;
//         acc.total_leave += e.leave_hours || 0;
//         return acc;
//       },
//       { total_productive: 0, total_non_productive: 0, total_idle: 0, total_downtime: 0, total_scheduled: 0, total_leave: 0 }
//     );

//     const overtimeLogs = await OvertimeLog.find({
//       supervisor_key: supervisorKey,
//       date: { $gte: startDate, $lte: endDate }
//     });

//     const total_overtime = overtimeLogs.reduce((sum, l) => sum + (l.overtime_hours || 0), 0);

//     const allTimeUsed = totals.total_productive + totals.total_non_productive + totals.total_idle;

//     const jobMetrics = completedJobs.reduce(
//       (acc, job) => {
//         acc.totalJobAllocated += job.allocated_hours || 0;
//         acc.totalJobConsumed += job.consumed_hours || 0;
//         if (job.actual_completion_date && job.target_completion_date && new Date(job.actual_completion_date) <= new Date(job.target_completion_date)) {
//           acc.onTimeJobs += 1;
//         }
//         return acc;
//       },
//       { totalJobAllocated: 0, totalJobConsumed: 0, onTimeJobs: 0 }
//     );

//     return {
//       report_type: 'supervisor_summary',
//       generated_at: new Date(),
//       period: { start: startDate, end: endDate },
//       team_metrics: {
//         total_technicians: totalTechnicians.size,
//         working_days: dayEntries.length,
//         total_hours_scheduled: _round(totals.total_scheduled),
//         total_hours_used: _round(allTimeUsed)
//       },
//       hours_breakdown: {
//         total_productive: _round(totals.total_productive),
//         total_non_productive: _round(totals.total_non_productive),
//         total_idle: _round(totals.total_idle),
//         total_downtime: _round(totals.total_downtime),
//         total_leave: _round(totals.total_leave),
//         total_overtime: _round(total_overtime)
//       },
//       kpis: reportKpis,
//       job_metrics: {
//         total_completed_jobs: completedJobs.length,
//         total_allocated_hours: _round(jobMetrics.totalJobAllocated),
//         total_consumed_hours: _round(jobMetrics.totalJobConsumed),
//         on_time_jobs: jobMetrics.onTimeJobs,
//         on_time_percent: completedJobs.length > 0 ? _round((jobMetrics.onTimeJobs / completedJobs.length) * 100) : 0,
//         average_job_efficiency: jobMetrics.totalJobAllocated > 0 ? _round((jobMetrics.totalJobConsumed / jobMetrics.totalJobAllocated) * 100) : 0
//       }
//     };
//   }
// }

// module.exports = KPICalculator;











/**
 * Central KPI Calculator Engine (Single Source of Truth)
 *
 * RULES ENFORCED:
 * - ALL KPI math originates from calculateDailyKPIs ONLY
 * - NO reverse conversion of utilization_percent → hours
 * - NO clamping (ever)
 * - NO TrainingLog recalculation in aggregates
 * - NO double counting across dashboard/supervisor/weekly/monthly
 */

const DayEntry = require('../models/DayEntry');
const TrainingLog = require('../models/TrainingLog');
const OvertimeLog = require('../models/OvertimeLog');
const DowntimeLog = require('../models/DowntimeLog');
const Job = require('../models/Job');
const AttendanceRecord = require('../models/AttendanceRecord');
const Technician = require('../models/Technician');

const SYSTEM_ALLOCATED = {
  meetingMinutes: 15,
  teaBreakMinutes: 15,
  lunchMinutes: 30,
  housekeepingMinutes: 30
};

const MINUTES_TO_HOURS = 1 / 60;

const AVAILABLE_PRODUCTIVE_HOURS = {
  weekday: 7.5,  // Mon–Thu
  friday: 6      // Friday  →  weekly total: 4×7.5 + 6 = 36 h
};

const AVAILABLE_HOURS = {
  weekday: 8.5,  // Mon–Thu scheduled (includes break)
  friday: 7      // Friday  scheduled
};

// ---------------- helpers ----------------
function _round(v) {
  return parseFloat((v || 0).toFixed(2));
}

function _isFriday(date) {
  return new Date(date).getDay() === 5;
}

function getAvailability(date) {
  const isFriday = _isFriday(date);
  return {
    available_hours: isFriday ? AVAILABLE_HOURS.friday : AVAILABLE_HOURS.weekday,
    available_productive_hours: isFriday
      ? AVAILABLE_PRODUCTIVE_HOURS.friday
      : AVAILABLE_PRODUCTIVE_HOURS.weekday
  };
}

function _midday(date) {
  // Deterministic day normalization: always use UTC-midnight.
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}



function _toYMD(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function _mondayStart(date) {
  const d = new Date(date);
  const dow = d.getDay();
  const diff = (dow === 0 ? -6 : 1) - dow;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------- ENTRY CLASSIFIER (multi-bucket) ----------------
// Always derives classification from live entry fields (category, is_idle, job_id).
// Never reads entry.time_category — that field defaults to 'productive' on all
// existing records and therefore cannot be trusted for backward-compatible data.
//
// Returns one of: 'productive' | 'training' | 'non_productive' | 'idle' | 'not_available'
//
// Training is deliberately its own bucket so it can appear in BOTH the
// Utilization numerator AND the Non-Productive numerator without double-counting
// the other non-productive categories.
function classifyForDashboard(entry) {
  if (entry.is_leave || ['Leave', 'Sick'].includes(entry.category)) {
    return 'not_available';
  }
  if (entry.category === 'Training') {
    return 'training';
  }
  // Admin and Waiting for Parts are non-productive but not idle
  if (['Admin', 'Waiting for Parts'].includes(entry.category)) {
    return 'non_productive';
  }
  if (entry.hour_category === 'utilization_loss') {
    return entry.is_idle ? 'idle' : 'non_productive';
  }
  if (!entry.is_idle && entry.job_id) {
    return 'productive';
  }
  // Idle (new), Housekeeping (legacy), Site Work, Travelling, Other → idle bucket
  return 'idle';
}

// ---------------- KPI SCHEMA + ENGINE HELPERS ----------------
const KPI_SCHEMA = {
  utilization_percent: 0,
  productivity_percent: 0,
  idle_percent: 0,
  non_productive_percent: 0,
  training_percent: 0,
  availability_percent: 0,
  efficiency_percent: 0
};

function validateKpiObject(kpis, context) {
  const schemaKeys = Object.keys(KPI_SCHEMA);
  const actualKeys = Object.keys(kpis || {});

  const missing = schemaKeys.filter(k => !(k in (kpis || {})));
  const extra = actualKeys.filter(k => !KPI_SCHEMA.hasOwnProperty(k));

  if (missing.length || extra.length) {
    const msg = `KPI schema validation failed${context ? ` (${context})` : ''}. missing=[${missing.join(',')}], extra=[${extra.join(',')}]`;
    throw new Error(msg);
  }

  for (const k of schemaKeys) {
    if (typeof kpis[k] !== 'number' || !Number.isFinite(kpis[k])) {
      throw new Error(
        `KPI schema validation failed${context ? ` (${context})` : ''}. Field '${k}' must be a finite number.`
      );
    }
  }
}

function validateAndFreezeKpis(kpis, context) {
  validateKpiObject(kpis, context);
  // Fail-closed: ensure no mutation after validation can bypass determinism/regression checks.
  return Object.freeze({ ...kpis });
}

// Backward-compatible internal alias (if referenced elsewhere)
const _validateKpiObject = validateKpiObject;


// Central KPI math ONLY lives here.
function buildKpis({
  availableHours,
  availableProductiveHours,
  productive,
  nonProductive,
  idle,
  training,
  scheduledHours,              // ALL active techs — used for availability denominator
  scheduledHoursForUtilization // participants only — used for utilization denominator
}, context) {
  // Guardrail: ensure callers cannot pass undefined and rely on JS coercion.
  // Any non-finite number will be caught by validateAndFreezeKpis().

  // utilization = (productive + training) / scheduled_hours
  // Use participant-scoped scheduled hours when provided so that active-but-not-logging
  // technicians do not silently inflate the denominator and suppress the team %.
  // Falls back to scheduledHours, then availableProductiveHours for backward compat.
  const utilizationNumerator = (productive || 0) + (training || 0);
  const utilizationDenominator =
    (scheduledHoursForUtilization != null && scheduledHoursForUtilization > 0)
      ? scheduledHoursForUtilization
      : (scheduledHours != null && scheduledHours > 0)
      ? scheduledHours
      : (availableProductiveHours || 0);

  const utilization_percent = utilizationDenominator > 0
    ? (utilizationNumerator / utilizationDenominator) * 100
    : 0;

  // productive % = job hours against the productive capacity baseline
  const productivity_percent = (availableProductiveHours || 0) > 0
    ? ((productive || 0) / availableProductiveHours) * 100
    : 0;

  const idle_percent = (availableHours || 0) > 0
    ? ((idle || 0) / availableHours) * 100
    : 0;

  // Non-productive % includes training + other non-productive + idle.
  // Training counts here because it is still time away from billable work,
  // even though it also contributes to utilization.
  const non_productive_percent = (availableProductiveHours || 0) > 0
    ? (((nonProductive || 0) + (idle || 0) + (training || 0)) / availableProductiveHours) * 100
    : 0;

  const training_percent = (availableProductiveHours || 0) > 0
    ? ((training || 0) / availableProductiveHours) * 100
    : 0;

  // If scheduledHours is provided (dashboard with leave data), compute real fraction.
  // Otherwise binary 0/100 for backward compat with single-tech daily calls.
  const availability_percent = (scheduledHours != null && scheduledHours > 0)
    ? ((availableHours || 0) / scheduledHours) * 100
    : (availableHours || 0) > 0 ? 100 : 0;

  // Efficiency = productive fraction of ALL logged hours
  const totalLogged = (productive || 0) + (nonProductive || 0) + (idle || 0) + (training || 0);
  const efficiency_percent = totalLogged > 0
    ? ((productive || 0) / totalLogged) * 100
    : 0;

  const kpis = {
    utilization_percent: _round(utilization_percent),
    productivity_percent: _round(productivity_percent),
    idle_percent: _round(idle_percent),
    non_productive_percent: _round(non_productive_percent),
    training_percent: _round(training_percent),
    availability_percent: _round(availability_percent),
    efficiency_percent: _round(efficiency_percent)
  };

  // Fail-fast + freeze (hard enforcement).
  return validateAndFreezeKpis(kpis, context);
}

// ---------------- DAILY KPI (SOURCE OF TRUTH) ----------------
class KPICalculator {
  static _safeDivide(numerator, denominator) {
    const den = Number(denominator);
    if (!den || !Number.isFinite(den) || den === 0) return 0;
    const num = Number(numerator);
    if (!Number.isFinite(num)) return 0;
    return num / den;
  }

  static _toUtilizationMetrics({
    total_productive_hours,
    total_non_productive_hours,
    total_idle_hours,
    total_training_hours,
    available_hours
  }) {
    const productiveHours = Number(total_productive_hours) || 0;
    const nonProductiveHours = Number(total_non_productive_hours) || 0;
    const idleHours = Number(total_idle_hours) || 0;
    const trainingHours = Number(total_training_hours) || 0;

    const notAvailableHours = nonProductiveHours + idleHours + trainingHours;
    const adjustedAvailableHours = productiveHours + notAvailableHours;

    const utilization =
      this._safeDivide(productiveHours, adjustedAvailableHours) * 100;

    const productivity = this._safeDivide(productiveHours, available_hours) * 100;

    const idlePercentage = this._safeDivide(idleHours, adjustedAvailableHours) * 100;

    // Ensure all are finite numbers (no undefined/null)
    return {
      productiveHours,
      nonProductiveHours,
      idleHours,
      trainingHours,
      notAvailableHours,
      adjustedAvailableHours,
      utilization: _round(utilization),
      productivity: _round(productivity),
      idlePercentage: _round(idlePercentage)
    };
  }

  static _isWeekend(date) {
    const dow = new Date(date).getDay();
    return dow === 0 || dow === 6;
  }



  static _sumAvailableProductiveHoursForDays(days) {
    return (days || []).reduce((sum, d) => {
      const date = _midday(d);
      if (this._isWeekend(date)) return sum;
      return sum + getAvailability(date).available_productive_hours;
    }, 0);
  }

  static _sumAvailableHoursForDays(days) {
    return (days || []).reduce((sum, d) => {
      const date = _midday(d);
      if (this._isWeekend(date)) return sum;
      return sum + _getAvailableHours(date);
    }, 0);
  }

  static async calculateDailyKPIs(supervisorKey, technicianId, date) {
    const day = _midday(date);

    const entry = await DayEntry.findOne({
      supervisor_key: supervisorKey,
      technician_id: technicianId,
      date: day
    });


    if (!entry) return this._empty(day);

    const absence = await AttendanceRecord.isAbsenceDay(
      supervisorKey,
      technicianId,
      day
    );

    if (absence) {
      return {
        date: day,
        scheduled_hours: entry.scheduled_hours,
        leave_hours: entry.leave_hours || 0,
        available_hours: 0,
        available_productive_hours: 0,
        total_productive_hours: 0,
        total_non_productive_hours: 0,
        total_idle_hours: 0,
        total_training_hours: 0,
        is_absence_day: true,
        kpis: buildKpis(
          {
            availableHours: 0,
            availableProductiveHours: 0,
            productive: 0,
            nonProductive: 0,
            idle: 0,
            training: 0
          },
          'daily_absence'
        )
      };
    }




    const availability = getAvailability(day);
    const availableHours = availability.available_hours;
    const availableProductiveHours = availability.available_productive_hours;



    const productive = entry.total_productive_hours || 0;
    const nonProductive = entry.total_non_productive_hours || 0;
    const idle = entry.total_idle_hours || 0;

    const trainingLogs = await TrainingLog.find({
      supervisor_key: supervisorKey,
      technician_id: technicianId,
      training_date: {
        $gte: day,
        $lte: new Date(day.getTime() + 86400000 - 1)
      }
    });

    const training = trainingLogs.reduce(
      (s, l) => s + (l.hours_spent || 0),
      0
    );

    // normalized KPI components -> centralized KPI math
    const kpis = buildKpis(
      {
        availableHours,
        availableProductiveHours,
        productive,
        nonProductive,
        idle,
        training
      },
      'daily'
    );

    return {
      date: day,
      scheduled_hours: entry.scheduled_hours,
      leave_hours: 0,
      available_hours: availableHours,
      available_productive_hours: availableProductiveHours,
      total_productive_hours: productive,
      total_non_productive_hours: nonProductive,
      total_idle_hours: idle,
      total_training_hours: training,
      is_absence_day: false,
      kpis
    };
  }


  static _empty(day) {
    return {
      date: day,
      scheduled_hours: 0,
      leave_hours: 0,
      available_hours: 0,
      available_productive_hours: 0,
      total_productive_hours: 0,
      total_non_productive_hours: 0,
      total_idle_hours: 0,
      total_training_hours: 0,
      is_absence_day: false,
      kpis: buildKpis(
        { availableHours: 0, availableProductiveHours: 0, productive: 0, nonProductive: 0, idle: 0, training: 0 },
        'empty'
      )
    };
  }

  // ---------------- WEEKLY ----------------
  static async calculateWeeklyKPIs(supervisorKey, technicianId, weekNumber, year) {
    const start = this._getWeekStartDate(year, weekNumber);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const { eachDayOfInterval } = require("date-fns");
    const days = eachDayOfInterval({ start, end });

    let totalAvailable = 0;
    let totalAvailableProductive = 0;
    let totalProductive = 0;
    let totalNonProductive = 0;
    let totalIdle = 0;
    let totalTraining = 0;

    // STRICT sum-only reducer architecture:
    // - call calculateDailyKPIs exactly once per day
    // - no continue/filtering based on is_absence_day
    // - absence days come back as zero values and naturally contribute nothing
    for (const d of days) {
      const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);

      // TEMP DEBUG (determinism): print daily components contributing to weekly.
      // Keep formulas unchanged.
      if (process.env.KPI_DETERMINISM_DEBUG === '1') {
        console.log('[weekly_day]', {
          date: _toYMD(d),
          available_hours: k.available_hours,
          available_productive_hours: k.available_productive_hours,
          total_productive_hours: k.total_productive_hours,
          total_non_productive_hours: k.total_non_productive_hours,
          total_idle_hours: k.total_idle_hours,
          total_training_hours: k.total_training_hours,
          is_absence_day: k.is_absence_day
        });
      }

      // Weekly is a pure aggregator over the daily KPI components.
      totalAvailable += k.available_hours || 0;
      totalAvailableProductive += k.available_productive_hours || 0;

      totalProductive += k.total_productive_hours || 0;
      totalNonProductive += k.total_non_productive_hours || 0;
      totalIdle += k.total_idle_hours || 0;
      totalTraining += k.total_training_hours || 0;
    }


    const kpis = buildKpis({
      availableHours: totalAvailable,
      availableProductiveHours: totalAvailableProductive,
      productive: totalProductive,
      nonProductive: totalNonProductive,
      idle: totalIdle,
      training: totalTraining
    });

    return {
      kpis,
      total_idle_hours: _round(totalIdle)
    };
  }


  // ---------------- MONTHLY ----------------
  static async calculateMonthlyKPIs(supervisorKey, technicianId, month, year) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    const { eachDayOfInterval } = require("date-fns");
    const days = eachDayOfInterval({ start, end });

    let totalAvailable = 0;
    let totalProductive = 0;
    let totalNonProductive = 0;
    let totalIdle = 0;
    let totalTraining = 0;

    for (const d of days) {
      const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);

      totalAvailable += k.available_hours || 0;

      // Monthly is a pure aggregator over the daily KPI components.
      totalProductive += k.total_productive_hours || 0;
      totalNonProductive += k.total_non_productive_hours || 0;
      totalIdle += k.total_idle_hours || 0;
      totalTraining += k.total_training_hours || 0;
    }


    const utilized =
      totalProductive +
      totalNonProductive +
      totalIdle +
      totalTraining;

    const kpis = buildKpis({
      availableHours: totalAvailable,
      availableProductiveHours: this._sumAvailableProductiveHoursForDays(days),
      productive: totalProductive,
      nonProductive: totalNonProductive,
      idle: totalIdle,
      training: totalTraining
    });

    return { kpis };
  }

  // ---------------- DASHBOARD ----------------
  // Reads from TimeLog (the active logging model) instead of DayEntry (never written to).
  static async calculateDashboardKPIs(supervisorKey, from, to, technicianId) {
    const TimeLog = require('../models/TimeLog');
    const { eachDayOfInterval } = require('date-fns');

    // Use local-time midnight to match TimeLog.normalizeLogDate (which uses setHours, not setUTCHours).
    // On UTC+ servers the UTC-based _midday would shift the window and miss records stored at local midnight.
    const startDate = new Date(from);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);

    console.log('[KPI DEBUG] calculateDashboardKPIs called', {
      supervisorKey,
      from,
      to,
      technicianId: technicianId || null,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    // 1. Fetch all TimeLog entries for this supervisor/range in one query
    const tlQuery = {
      supervisor_key: supervisorKey,
      log_date: { $gte: startDate, $lte: endDate }
    };
    if (technicianId) tlQuery.technician_id = technicianId;

    const timeLogs = await TimeLog.find(tlQuery).lean();

    console.log('[KPI DEBUG] TimeLog query result', {
      query: JSON.stringify(tlQuery),
      count: timeLogs.length,
      sample: timeLogs[0]
        ? {
            technician_id: timeLogs[0].technician_id,
            log_date: timeLogs[0].log_date,
            time_category: timeLogs[0].time_category,
            hours_logged: timeLogs[0].hours_logged,
            category: timeLogs[0].category,
          }
        : null,
    });

    if (timeLogs.length === 0) {
      console.warn('[KPI WARNING] No TimeLog records found for range', { supervisorKey, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
    }

    // 2. Determine which technicians to aggregate across.
    // Always start from time-log owners so the set is never smaller than the data.
    const techSet = new Set(timeLogs.map(e => String(e.technician_id)));

    if (technicianId) {
      // Single-tech view (technician portal): scope to only that technician.
      techSet.add(String(technicianId));
    } else {
      // Workshop view: include ALL active technicians so that technicians who
      // have no time logs yet still contribute their scheduled hours to the
      // denominator.  Without this, a day where only one technician logs leave
      // shows 0% availability because every other working technician is excluded.
      const techQuery = supervisorKey === 'component'
        ? { $or: [{ supervisor_key: 'component' }, { supervisor_key: { $exists: false } }], status: 'active' }
        : { supervisor_key: supervisorKey, status: 'active' };
      const activeTechs = await Technician.find(techQuery).select('_id').lean();
      for (const t of activeTechs) techSet.add(String(t._id));
    }

    if (techSet.size === 0) {
      const kpis = buildKpis(
        { availableHours: 0, availableProductiveHours: 0, productive: 0, nonProductive: 0, idle: 0, training: 0 },
        'dashboard_empty'
      );
      console.info('[KPI] No technician data found for range', { supervisorKey, from, to });
      return { hasData: false, kpis };
    }

    // 3. Batch-fetch approved AttendanceRecords (avoids N×M per-day DB queries)
    const absenceQuery = {
      supervisor_key: supervisorKey,
      date: { $gte: startDate, $lte: endDate },
      status: 'approved'
    };
    if (technicianId) absenceQuery.technician_id = technicianId;

    const absenceRecords = await AttendanceRecord.find(absenceQuery).lean();
    console.log('[KPI DEBUG] Leave records (AttendanceRecord)', { count: absenceRecords.length });
    const absenceSet = new Set(
      absenceRecords.map(r => `${String(r.technician_id)}_${_toYMD(r.date)}`)
    );
    // Maps key → 'leave'|'sick' so we can show the correct category in drill-down entries
    const absenceTypeMap = new Map(
      absenceRecords.map(r => [`${String(r.technician_id)}_${_toYMD(r.date)}`, r.attendance_type])
    );

    // 4. Group TimeLogs by `${techId}_${dateStr}` for O(1) lookup
    const tlMap = new Map();
    for (const entry of timeLogs) {
      const key = `${String(entry.technician_id)}_${_toYMD(entry.log_date)}`;
      if (!tlMap.has(key)) tlMap.set(key, []);
      tlMap.get(key).push(entry);
    }

    const days = eachDayOfInterval({ start: startDate, end: endDate });

    // Per-day accumulator for the Performance tab chart series
    const dailyMap = new Map();
    for (const d of days) {
      if (this._isWeekend(d)) continue;
      dailyMap.set(_toYMD(d), {
        date: _toYMD(d),
        scheduledHours: 0,
        effectiveAvailable: 0,
        availableProductive: 0,
        productiveHours: 0,
        trainingHours: 0,
        nonProductiveHours: 0,
        idleHours: 0,
        notAvailableHours: 0,
      });
    }

    let totalScheduled = 0;
    let totalEffectiveAvailable = 0;
    let totalAvailableProductive = 0;
    let totalProductive = 0;
    let totalNonProductive = 0;
    let totalIdle = 0;
    let totalTraining = 0;

    // Per-technician detail map — collected alongside the main aggregates so
    // the frontend can render drill-down dialogs without a second API call.
    // Buckets are kept separate so each drill-down card shows ONLY the entries
    // that were used in its formula numerator.
    const techDetailsMap = new Map();

    for (const tech of techSet) {
      techDetailsMap.set(tech, {
        technician_id: tech,
        scheduled_hours: 0,
        available_hours: 0,            // scheduled minus full-day absences and inline leave
        available_productive_hours: 0, // productive capacity after leave adjustment
        productive_hours: 0,
        training_hours: 0,
        non_productive_hours: 0,       // excludes training
        idle_hours: 0,
        not_available_hours: 0,
        // per-tech KPI percentages — computed after the accumulation loop
        productivity_percent: 0,
        utilization_percent: 0,
        efficiency_percent: 0,
        non_productive_percent: 0,
        productive_entries: [],        // job entries → Productive card
        training_entries: [],          // Training entries → Utilization + Non-Productive cards
        non_productive_entries: [],    // Admin/WFP/etc. → Non-Productive card
        idle_entries: [],              // Idle entries → Non-Productive card
        not_available_entries: [],     // Leave/Sick entries → Availability card
      });

      const techDetail = techDetailsMap.get(tech);

      for (const d of days) {
        // Use d directly (local midnight from eachDayOfInterval) — do NOT call _midday()
        // here because _midday normalises to UTC midnight, which shifts the date in UTC+
        // timezones and produces a different key than the one in tlMap.
        if (this._isWeekend(d)) continue;

        const { available_hours, available_productive_hours } = getAvailability(d);
        const dateStr = _toYMD(d);
        const key = `${tech}_${dateStr}`;

        totalScheduled += available_hours;
        techDetail.scheduled_hours += available_hours;
        const dayData = dailyMap.get(dateStr);
        if (dayData) dayData.scheduledHours += available_hours;

        // Approved full-day absence: contributes to scheduled but not to available hours
        if (absenceSet.has(key)) {
          techDetail.not_available_hours += available_hours;
          const absType = absenceTypeMap.get(key);
          techDetail.not_available_entries.push({
            date: dateStr,
            category: absType === 'sick' ? 'Sick' : 'Leave',
            hours: available_hours,
            full_day: true,
          });
          if (dayData) dayData.notAvailableHours += available_hours;
          continue;
        }

        // Sum TimeLog entries for this tech-day by time_category
        const dayEntries = tlMap.get(key) || [];
        let notAvailableHrs = 0;
        let dayProductive = 0, dayTraining = 0, dayNonProductive = 0, dayIdle = 0;

        for (const entry of dayEntries) {
          const hrs = Number(entry.hours_logged || 0);
          // Always classify from live entry fields — never trust entry.time_category,
          // which defaults to 'productive' on all records written before the fix.
          const cat = classifyForDashboard(entry);

          switch (cat) {
            case 'productive':
              totalProductive += hrs;
              techDetail.productive_hours += hrs;
              techDetail.productive_entries.push({
                date: dateStr,
                job_id: entry.job_id || null,
                hours: hrs,
              });
              dayProductive += hrs;
              break;
            case 'training':
              totalTraining += hrs;
              techDetail.training_hours += hrs;
              techDetail.training_entries.push({
                date: dateStr,
                category: 'Training',
                hours: hrs,
              });
              dayTraining += hrs;
              break;
            case 'non_productive':
              totalNonProductive += hrs;
              techDetail.non_productive_hours += hrs;
              techDetail.non_productive_entries.push({
                date: dateStr,
                category: entry.category || 'Non-Productive',
                hours: hrs,
              });
              dayNonProductive += hrs;
              break;
            case 'idle':
              totalIdle += hrs;
              techDetail.idle_hours += hrs;
              techDetail.idle_entries.push({
                date: dateStr,
                category: entry.category || 'Idle',
                sub_reason: String(entry.category_detail || '').trim() || null,
                hours: hrs,
              });
              dayIdle += hrs;
              break;
            case 'not_available':
              notAvailableHrs += hrs;
              techDetail.not_available_hours += hrs;
              techDetail.not_available_entries.push({
                date: dateStr,
                category: entry.category || 'Leave',
                hours: hrs,
                full_day: false,
              });
              break;
            default:
              totalIdle += hrs;
              techDetail.idle_hours += hrs;
              dayIdle += hrs;
          }
        }

        // Effective available = scheduled minus leave/sick logged directly in TimeLog
        const effectiveAvailable = Math.max(0, available_hours - notAvailableHrs);
        totalEffectiveAvailable += effectiveAvailable;
        techDetail.available_hours += effectiveAvailable;

        // Productive capacity is binary: any leave/sick entry on this day → 0.
        // Idle, Admin, WFP, and missing entries do NOT reduce productive capacity.
        const techDayAvailProductive = notAvailableHrs > 0 ? 0 : available_productive_hours;
        totalAvailableProductive += techDayAvailProductive;
        techDetail.available_productive_hours += techDayAvailProductive;

        if (dayData) {
          dayData.effectiveAvailable += effectiveAvailable;
          dayData.availableProductive += techDayAvailProductive;
          dayData.notAvailableHours += notAvailableHrs;
          dayData.productiveHours += dayProductive;
          dayData.trainingHours += dayTraining;
          dayData.nonProductiveHours += dayNonProductive;
          dayData.idleHours += dayIdle;
        }
      }
    }

    // Compute per-technician KPI percentages and leave/sick day counts
    for (const techDetail of techDetailsMap.values()) {
      const avProd = techDetail.available_productive_hours;
      const avHrs  = techDetail.available_hours;
      const sched  = techDetail.scheduled_hours;
      const prod   = techDetail.productive_hours;
      const train  = techDetail.training_hours;
      const np     = techDetail.non_productive_hours;
      const idle   = techDetail.idle_hours;
      const totalLogged = prod + train + np + idle;

      techDetail.productivity_percent   = avProd > 0 ? _round((prod / avProd) * 100) : 0;
      // Utilization uses scheduled_hours (8.5/7 h) so leave days stay in denominator
      techDetail.utilization_percent    = sched  > 0 ? _round(((prod + train) / sched) * 100) : 0;
      techDetail.efficiency_percent     = totalLogged > 0 ? _round((prod / totalLogged) * 100) : 0;
      // Non-productive % uses available productive hours (7.5/6) as denominator, not total scheduled (8.5/7)
      techDetail.non_productive_percent = avProd > 0 ? _round(((np + idle + train) / avProd) * 100) : 0;

      // Count distinct leave and sick dates from time log entries
      const leaveDates = new Set(
        techDetail.not_available_entries
          .filter(e => e.category === 'Leave' || e.category === 'leave')
          .map(e => e.date)
      );
      const sickDates = new Set(
        techDetail.not_available_entries
          .filter(e => e.category === 'Sick' || e.category === 'sick')
          .map(e => e.date)
      );
      techDetail.leave_days = leaveDates.size;
      techDetail.sick_days  = sickDates.size;
    }

    // Re-derive ALL team totals by summing the per-technician breakdown.
    // This guarantees that TEAM TOTAL rows in every drill-down dialog equal
    // exactly SUM(technician rows) — no phantom hours from extra IDs in techSet.
    totalScheduled          = 0;
    totalEffectiveAvailable = 0;
    totalAvailableProductive = 0;
    totalProductive         = 0;
    totalNonProductive      = 0;
    totalIdle               = 0;
    totalTraining           = 0;
    let totalLeaveDays = 0;
    let totalSickDays  = 0;
    let totalNotAvailableHours = 0;

    for (const td of techDetailsMap.values()) {
      totalScheduled           += td.scheduled_hours;
      totalEffectiveAvailable  += td.available_hours;
      totalAvailableProductive += td.available_productive_hours;
      totalProductive          += td.productive_hours;
      totalNonProductive       += td.non_productive_hours;
      totalIdle                += td.idle_hours;
      totalTraining            += td.training_hours;
      totalLeaveDays           += td.leave_days || 0;
      totalSickDays            += td.sick_days  || 0;
      totalNotAvailableHours   += td.not_available_hours || 0;
    }

    // ── Participant-scoped denominators ───────────────────────────────────────────
    // techSet includes ALL active technicians (needed for correct availability %).
    // But technicians who have zero logs AND zero absence records in this period
    // are "ghosts" — they inflate the utilization/productivity denominators without
    // contributing to numerators, silently suppressing the team percentages.
    // Scope utilization/productivity denominators to participants only.
    const participantSet = new Set([
      ...timeLogs.map(e => String(e.technician_id)),
      ...absenceRecords.map(r => String(r.technician_id))
    ]);

    let participantScheduled          = 0;
    let participantEffectiveAvailable = 0;
    let participantAvailableProductive = 0;
    for (const [techId, td] of techDetailsMap.entries()) {
      if (!participantSet.has(techId)) continue;
      participantScheduled           += td.scheduled_hours;
      participantEffectiveAvailable  += td.available_hours;
      participantAvailableProductive += td.available_productive_hours;
    }

    console.log('[KPI DEBUG] Aggregation result (re-derived from breakdown)', {
      techs: techDetailsMap.size,
      participants: participantSet.size,
      totalScheduled,
      participantScheduled,
      totalEffectiveAvailable,
      participantEffectiveAvailable,
      totalAvailableProductive,
      participantAvailableProductive,
      totalProductive,
      totalNonProductive,
      totalIdle,
      totalTraining,
    });

    // Build daily chart series (sorted ascending by date)
    const series = Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => {
        const avProd = d.availableProductive;
        const sched  = d.scheduledHours;
        return {
          date: d.date,
          productiveHours: _round(d.productiveHours),
          totalHours: _round(avProd),
          notAvailableHours: 0,
          availableProductiveHours: _round(avProd),
          scheduledHours: _round(sched),
          trainingHours: _round(d.trainingHours),
          productivity_percent: avProd > 0 ? _round((d.productiveHours / avProd) * 100) : 0,
          utilization_percent: sched  > 0 ? _round(((d.productiveHours + d.trainingHours) / sched) * 100) : 0,
        };
      });

    const kpis = buildKpis({
      availableHours: participantEffectiveAvailable,
      availableProductiveHours: participantAvailableProductive,
      productive: totalProductive,
      nonProductive: totalNonProductive,
      idle: totalIdle,
      training: totalTraining,
      scheduledHours: totalScheduled,               // ALL active techs → availability is correct
      scheduledHoursForUtilization: participantScheduled  // participants only → utilization/productivity are correct
    }, 'dashboard');

    // Include leave/sick hours so a leave-only day is still counted as "has data"
    const totalTrackedHours = totalProductive + totalNonProductive + totalIdle + totalTraining + totalNotAvailableHours;
    const hasData = totalTrackedHours > 0;

    if (!hasData) {
      console.info('[KPI] No tracked hours found in selected period', { supervisorKey, from, to, techs: techDetailsMap.size });
    }

    const details = {
      technicians: Array.from(techDetailsMap.values()),
      totals: {
        scheduled_hours: totalScheduled,
        available_hours: totalEffectiveAvailable,
        available_productive_hours: totalAvailableProductive,
        productive_hours: totalProductive,
        training_hours: totalTraining,
        non_productive_hours: totalNonProductive,
        idle_hours: totalIdle,
        not_available_hours: totalScheduled - totalEffectiveAvailable,
        leave_days: totalLeaveDays,
        sick_days: totalSickDays,
      },
    };

    return {
      hasData,
      kpis,
      details,
      series,
      leave_days: totalLeaveDays,
      sick_days: totalSickDays,
      training_hours: _round(totalTraining),
    };
  }

  // ---------------- WEEK START ----------------
  static _getWeekStartDate(year, week) {
    // Deterministic week start based on UTC-midnight to avoid local/DST shifts.
    const first = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const dow = first.getUTCDay() || 7;
    const offset = 1 - dow;

    const firstMonday = new Date(Date.UTC(year, 0, 1 + offset, 0, 0, 0, 0));
    const d = new Date(firstMonday);
    d.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
    return d;
  }

  // ---------------- UTILIZATION BACKEND (routes) ----------------
  // These wrappers exist ONLY to match the utilization.routes.js contract.
  // They must NOT duplicate KPI aggregation logic; they consume the existing KPI engine outputs.
  static async calculateDailyUtilizationProductivity(
    supervisorKey,
    technicianId,
    startDate,
    endDate
  ) {
    const { eachDayOfInterval } = require('date-fns');
    const days = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate)
    });

    let total_productive_hours = 0;
    let total_non_productive_hours = 0;
    let total_idle_hours = 0;
    let total_training_hours = 0;
    let available_hours = 0;

    for (const d of days) {
      const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);

      available_hours += k.available_hours || 0;
      total_productive_hours += k.total_productive_hours || 0;
      total_non_productive_hours += k.total_non_productive_hours || 0;
      total_idle_hours += k.total_idle_hours || 0;
      total_training_hours += k.total_training_hours || 0;
    }

    return this._toUtilizationMetrics({
      total_productive_hours,
      total_non_productive_hours,
      total_idle_hours,
      total_training_hours,
      available_hours
    });
  }

  static async calculateMonthlyUtilizationProductivity(
    supervisorKey,
    technicianId,
    startDate,
    endDate
  ) {
    // Current utilization.routes.js passes startDate/endDate as actual Date objects.
    // The KPI engine's calculateMonthlyKPIs uses (month, year), so we compute monthly range by summing daily KPIs
    // via the existing calculateDailyKPIs() aggregator below (no duplicated math).

    const { eachDayOfInterval } = require('date-fns');
    const days = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate)
    });

    let total_productive_hours = 0;
    let total_non_productive_hours = 0;
    let total_idle_hours = 0;
    let total_training_hours = 0;
    let available_hours = 0;

    for (const d of days) {
      const k = await this.calculateDailyKPIs(supervisorKey, technicianId, d);

      available_hours += k.available_hours || 0;
      total_productive_hours += k.total_productive_hours || 0;
      total_non_productive_hours += k.total_non_productive_hours || 0;
      total_idle_hours += k.total_idle_hours || 0;
      total_training_hours += k.total_training_hours || 0;
    }

    return this._toUtilizationMetrics({
      total_productive_hours,
      total_non_productive_hours,
      total_idle_hours,
      total_training_hours,
      available_hours
    });
  }
}

module.exports = KPICalculator;
