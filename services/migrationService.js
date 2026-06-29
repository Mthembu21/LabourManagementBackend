/**
 * Migration Service for LMS Data Structure Enhancement
 * Handles parallel migration from legacy models to new structures
 * Safe: Keeps both systems running during transition
 */

const DayEntry = require('../models/DayEntry');
const WeekEntry = require('../models/WeekEntry');
const TrainingLog = require('../models/TrainingLog');
const DowntimeLog = require('../models/DowntimeLog');
const OvertimeLog = require('../models/OvertimeLog');
const DailyTimeEntry = require('../models/DailyTimeEntry');
const TimeLog = require('../models/TimeLog');
const Job = require('../models/Job');

class MigrationService {
    /**
     * Migrate single DailyTimeEntry to new DayEntry structure
     * Preserves relationship for rollback capability
     */
    static async migrateSingleDailyEntry(dailyEntry) {
        try {
            // Check if already migrated
            const existing = await DayEntry.findOne({
                supervisor_key: dailyEntry.supervisor_key,
                technician_id: dailyEntry.technician_id,
                date: dailyEntry.date
            });

            if (existing && existing.is_migrated_from_legacy) {
                return existing;
            }

            // Create job entry from daily time entry
            const jobEntry = {
                job_id: dailyEntry.job_id,
                job_number: dailyEntry.job_number,
                productive_hours: dailyEntry.productive_hours || 0,
                overtime_hours: dailyEntry.overtime_hours || 0,
                notes: dailyEntry.notes,
                job_status: 'completed',
                created_at: dailyEntry.createdAt
            };

            // Create new DayEntry
            const newDayEntry = await DayEntry.findOneAndUpdate(
                {
                    supervisor_key: dailyEntry.supervisor_key,
                    technician_id: dailyEntry.technician_id,
                    date: dailyEntry.date
                },
                {
                    $setOnInsert: {
                        supervisor_key: dailyEntry.supervisor_key,
                        technician_id: dailyEntry.technician_id,
                        technician_name: dailyEntry.technician_name,
                        date: dailyEntry.date,
                        day_of_week: dailyEntry.day_of_week,
                        scheduled_hours: this._getScheduledHours(dailyEntry.date),
                        is_migrated_from_legacy: true,
                        legacy_daily_time_entry_id: dailyEntry._id
                    },
                    $push: { job_entries: jobEntry }
                },
                { upsert: true, new: true }
            );

            return newDayEntry;
        } catch (error) {
            console.error('Error migrating daily entry:', error);
            throw error;
        }
    }

    /**
     * Migrate all DailyTimeEntry records for a date range
     */
    static async migrateDateRange(startDate, endDate, supervisorKey = null) {
        try {
            const query = { date: { $gte: startDate, $lte: endDate } };
            if (supervisorKey) {
                query.supervisor_key = supervisorKey;
            }

            const dailyEntries = await DailyTimeEntry.find(query);

            const results = [];
            for (const entry of dailyEntries) {
                const migrated = await this.migrateSingleDailyEntry(entry);
                results.push(migrated);
            }

            return {
                success: true,
                migrated_count: results.length,
                date_range: { start: startDate, end: endDate }
            };
        } catch (error) {
            console.error('Error in batch migration:', error);
            throw error;
        }
    }

    /**
     * Migrate TimeLog entries with hour_category to new structure
     */
    static async migrateTimeLogs(startDate, endDate, supervisorKey = null) {
        try {
            const query = { log_date: { $gte: startDate, $lte: endDate } };
            if (supervisorKey) {
                query.supervisor_key = supervisorKey;
            }

            const timeLogs = await TimeLog.find(query);

            for (const log of timeLogs) {
                // Find or create DayEntry
                let dayEntry = await DayEntry.findOne({
                    supervisor_key: log.supervisor_key,
                    technician_id: log.technician_id,
                    date: log.log_date
                });

                if (!dayEntry) {
                    dayEntry = new DayEntry({
                        supervisor_key: log.supervisor_key,
                        technician_id: log.technician_id,
                        technician_name: log.technician_name || 'Unknown',
                        date: log.log_date,
                        day_of_week: this._getDayOfWeek(log.log_date),
                        scheduled_hours: this._getScheduledHours(log.log_date),
                        is_migrated_from_legacy: true
                    });
                } else if (!dayEntry.is_migrated_from_legacy) {
                    dayEntry.is_migrated_from_legacy = true;
                }

                // Create or update job entry
                const jobEntryIndex = dayEntry.job_entries.findIndex(
                    e => e.job_id === log.job_id
                );

                const jobEntry = {
                    job_id: log.job_id,
                    job_number: log.job_number || log.job_id,
                    subtask_id: log.subtask_id,
                    subtask_title: log.subtask_title,
                    job_status: 'completed'
                };

                // Categorize hours
                if (log.hour_category === 'productive') {
                    jobEntry.productive_hours = (log.normal_hours || 0) + (log.overtime_hours || 0);
                } else if (log.hour_category === 'non_productive') {
                    jobEntry.non_productive_hours = log.hours_logged || 0;
                } else if (log.hour_category === 'idle' || log.is_idle) {
                    jobEntry.idle_hours = log.hours_logged || 0;
                }

                if (jobEntryIndex >= 0) {
                    dayEntry.job_entries[jobEntryIndex] = {
                        ...dayEntry.job_entries[jobEntryIndex],
                        ...jobEntry
                    };
                } else {
                    dayEntry.job_entries.push(jobEntry);
                }

                await dayEntry.save();
            }

            return {
                success: true,
                migrated_count: timeLogs.length,
                date_range: { start: startDate, end: endDate }
            };
        } catch (error) {
            console.error('Error migrating time logs:', error);
            throw error;
        }
    }

    /**
     * Aggregate DayEntries into WeekEntry
     */
    static async aggregateToWeekEntry(weekNumber, year, technician_id, supervisor_key) {
        try {
            const weekStart = this._getWeekStartDate(year, weekNumber);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);

            const dayEntries = await DayEntry.find({
                supervisor_key,
                technician_id,
                date: { $gte: weekStart, $lte: weekEnd }
            });

            if (dayEntries.length === 0) {
                return null;
            }

            const dailyRecords = dayEntries.map(day => ({
                date: day.date,
                day_of_week: day.day_of_week,
                productive_hours: day.total_productive_hours || 0,
                non_productive_hours: day.total_non_productive_hours || 0,
                idle_hours: day.total_idle_hours || 0,
                overtime_hours: day.total_overtime_hours || 0,
                downtime_hours: day.total_downtime_hours || 0,
                leave_hours: day.leave_hours || 0,
                available_hours: day.available_productive_hours || 0,
                jobs_count: day.job_entries.length
            }));

            const weekEntry = new WeekEntry({
                supervisor_key,
                technician_id,
                technician_name: dayEntries[0].technician_name,
                week_number: weekNumber,
                year,
                week_start_date: weekStart,
                week_end_date: weekEnd,
                daily_records: dailyRecords,
                is_migrated: true
            });

            await weekEntry.save();
            return weekEntry;
        } catch (error) {
            console.error('Error aggregating to week entry:', error);
            throw error;
        }
    }

    /**
     * Helper: Get scheduled hours based on day of week
     */
    static _getScheduledHours(date) {
        const dayOfWeek = date.getDay();
        // Friday = 5, return 5.5; others return 7.5
        return dayOfWeek === 5 ? 5.5 : 7.5;
    }

    /**
     * Helper: Get day of week string
     */
    static _getDayOfWeek(date) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    /**
     * Helper: Get week start date (Monday)
     */
    static _getWeekStartDate(year, weekNumber) {
        const simple = new Date(year, 0, 1 + (weekNumber - 1) * 7);
        const dow = simple.getDay();
        const ISOweekStart = simple;
        if (dow <= 4)
            ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
        else
            ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
        return ISOweekStart;
    }

    /**
     * Generate migration report
     */
    static async generateMigrationReport(supervisorKey = null) {
        try {
            const query = supervisorKey ? { supervisor_key: supervisorKey } : {};

            const legacyCount = await DailyTimeEntry.countDocuments(query);
            const newCount = await DayEntry.countDocuments({ ...query, is_migrated_from_legacy: true });
            const weekEntriesCount = await WeekEntry.countDocuments(query);
            const trainingCount = await TrainingLog.countDocuments(query);
            const downtimeCount = await DowntimeLog.countDocuments(query);
            const overtimeCount = await OvertimeLog.countDocuments(query);

            return {
                legacy_daily_entries: legacyCount,
                migrated_day_entries: newCount,
                week_entries: weekEntriesCount,
                training_logs: trainingCount,
                downtime_logs: downtimeCount,
                overtime_logs: overtimeCount,
                migration_progress: {
                    percentage: legacyCount > 0 ? ((newCount / legacyCount) * 100).toFixed(2) + '%' : '0%',
                    migrated: newCount,
                    remaining: legacyCount - newCount
                }
            };
        } catch (error) {
            console.error('Error generating migration report:', error);
            throw error;
        }
    }
}

module.exports = MigrationService;
