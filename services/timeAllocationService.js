const WorkingDayScheduleConfig = require('../models/WorkingDayScheduleConfig');
const AttendanceRecord = require('../models/AttendanceRecord');

class TimeAllocationService {
    /**
     * Get active working day schedule for a specific date
     * @param {Date} date - The date to check
     * @returns {Promise<Object>} Schedule configuration with available hours
     */
    static async getWorkingDaySchedule(date) {
        try {
            const dayType = WorkingDayScheduleConfig.getDayType(date);
            const schedule = await WorkingDayScheduleConfig.getActiveSchedule(dayType);

            if (!schedule) {
                // Fallback to defaults if no config found
                return {
                    day_type: dayType,
                    total_scheduled_hours: dayType === 'friday' ? 7 : 8.5,
                    available_productive_hours: dayType === 'friday' ? 6 : 7.5,
                    total_fixed_hours: 1.5,
                    fixed_non_productive_blocks: [
                        { name: 'Meeting', duration_hours: 0.25 },
                        { name: 'Tea Break', duration_hours: 0.25 },
                        { name: 'Lunch', duration_hours: 0.5 },
                        { name: 'Housekeeping', duration_hours: 0.5 }
                    ]
                };
            }

            return schedule.toObject();
        } catch (error) {
            console.error('Error getting working day schedule:', error);
            throw error;
        }
    }

    /**
     * Get available productive hours for a date
     * @param {Date} date - The date to check
     * @returns {Promise<Number>} Available productive hours (7 for Mon-Thu, 6 for Friday)
     */
    static async getAvailableProductiveHours(date) {
        try {
            const schedule = await this.getWorkingDaySchedule(date);
            return schedule.available_productive_hours;
        } catch (error) {
            console.error('Error getting available productive hours:', error);
            const dayOfWeek = new Date(date).getDay();
            return dayOfWeek === 5 ? 6 : 7.5; // Fallback
        }
    }

    /**
     * Check if a date is an approved leave or sick day
     * @param {String} supervisorKey - Supervisor key
     * @param {ObjectId} technicianId - Technician ID
     * @param {Date} date - The date to check
     * @returns {Promise<Boolean>} True if date is an approved leave/sick day
     */
    static async isLeaveOrSickDay(supervisorKey, technicianId, date) {
        try {
            return await AttendanceRecord.isAbsenceDay(supervisorKey, technicianId, date);
        } catch (error) {
            console.error('Error checking absence day:', error);
            return false;
        }
    }

    /**
     * Get absence details (type, hours) for a date
     * @param {String} supervisorKey - Supervisor key
     * @param {ObjectId} technicianId - Technician ID
     * @param {Date} date - The date to check
     * @returns {Promise<Object|null>} Absence details or null if not an absence day
     */
    static async getAbsenceDetails(supervisorKey, technicianId, date) {
        try {
            return await AttendanceRecord.getAbsenceDetails(supervisorKey, technicianId, date);
        } catch (error) {
            console.error('Error getting absence details:', error);
            return null;
        }
    }

    /**
     * Allocate fixed non-productive time blocks to a day
     * @param {Object} dayEntry - The day entry object
     * @returns {Object} Allocation breakdown
     */
    static async allocateFixedNonProductiveTime(dayEntry) {
        try {
            const schedule = await this.getWorkingDaySchedule(dayEntry.date);

            return {
                date: dayEntry.date,
                day_type: schedule.day_type,
                total_scheduled_hours: schedule.total_scheduled_hours,
                system_allocated_non_productive: {
                    blocks: schedule.fixed_non_productive_blocks,
                    total_hours: schedule.total_fixed_hours,
                    description: 'Automatically allocated fixed non-productive time'
                },
                available_productive_hours: schedule.available_productive_hours,
                remaining_after_fixed: schedule.available_productive_hours
            };
        } catch (error) {
            console.error('Error allocating fixed non-productive time:', error);
            throw error;
        }
    }

    /**
     * Calculate effective day metrics considering leave/sick and scheduled hours
     * @param {Object} dayEntry - Day entry with logged hours
     * @param {String} supervisorKey - Supervisor key
     * @returns {Promise<Object>} Comprehensive day metrics
     */
    static async calculateEffectiveDayMetrics(dayEntry, supervisorKey) {
        try {
            const { technician_id, date, total_productive_hours = 0, total_non_productive_hours = 0, total_idle_hours = 0 } = dayEntry;

            // Check for leave/sick
            const absenceDetails = await this.getAbsenceDetails(supervisorKey, technician_id, date);

            if (absenceDetails) {
                return {
                    date,
                    is_absence_day: true,
                    absence_type: absenceDetails.type,
                    absence_hours: absenceDetails.hours,
                    kpi_applicable: false,
                    metrics: {
                        productive_hours: 0,
                        non_productive_hours: 0,
                        idle_hours: 0,
                        total_logged: 0
                    }
                };
            }

            // Normal working day
            const schedule = await this.getWorkingDaySchedule(date);
            const totalLogged = total_productive_hours + total_non_productive_hours + total_idle_hours;
            const availableProductive = schedule.available_productive_hours;

            return {
                date,
                is_absence_day: false,
                kpi_applicable: true,
                schedule: {
                    total_scheduled_hours: schedule.total_scheduled_hours,
                    system_allocated_non_productive: schedule.total_fixed_hours,
                    available_productive_hours: availableProductive
                },
                metrics: {
                    productive_hours: total_productive_hours,
                    non_productive_hours: total_non_productive_hours,
                    idle_hours: total_idle_hours,
                    total_logged: totalLogged
                },
                kpi: {
                    utilization_percent: availableProductive > 0 ? (total_productive_hours / availableProductive) * 100 : 0,
                    productivity_percent: (total_productive_hours + total_non_productive_hours) > 0
                        ? (total_productive_hours / (total_productive_hours + total_non_productive_hours)) * 100
                        : 0,
                    idle_percent: availableProductive > 0 ? (total_idle_hours / availableProductive) * 100 : 0,
                    remaining_capacity: Math.max(0, availableProductive - total_productive_hours)
                }
            };
        } catch (error) {
            console.error('Error calculating effective day metrics:', error);
            throw error;
        }
    }

    /**
     * Validate time entry against schedule constraints
     * @param {Object} params - Validation parameters
     * @returns {Promise<Object>} Validation result with error details if invalid
     */
    static async validateTimeEntry(params) {
        const {
            supervisorKey,
            technicianId,
            date,
            hoursToLog,
            alreadyLoggedToday = 0
        } = params;

        try {
            // Check if leave/sick day
            const isAbsence = await this.isLeaveOrSickDay(supervisorKey, technicianId, date);
            if (isAbsence) {
                const absenceDetails = await this.getAbsenceDetails(supervisorKey, technicianId, date);
                return {
                    valid: false,
                    error: `Cannot log hours on ${absenceDetails.type} day`,
                    details: absenceDetails
                };
            }

            // Get available productive hours
            const availableProductive = await this.getAvailableProductiveHours(date);
            const totalWouldBe = alreadyLoggedToday + hoursToLog;

            if (totalWouldBe > availableProductive + 1e-9) {
                return {
                    valid: false,
                    error: `Cannot log more than ${availableProductive} productive hours`,
                    available: availableProductive,
                    already_logged: alreadyLoggedToday,
                    requested: hoursToLog,
                    remaining: Math.max(0, availableProductive - alreadyLoggedToday)
                };
            }

            return {
                valid: true,
                available_productive_hours: availableProductive,
                remaining_capacity: availableProductive - totalWouldBe
            };
        } catch (error) {
            console.error('Error validating time entry:', error);
            return {
                valid: false,
                error: 'Error validating time entry',
                details: error.message
            };
        }
    }

    /**
     * Get summary of time allocation for a date
     * @param {Date} date - The date
     * @returns {Promise<Object>} Time allocation summary
     */
    static async getTimeAllocationSummary(date) {
        try {
            const schedule = await this.getWorkingDaySchedule(date);
            const dayOfWeek = new Date(date).getDay();
            const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];

            return {
                date,
                day_name: dayName,
                day_type: schedule.day_type,
                total_scheduled_hours: schedule.total_scheduled_hours,
                fixed_allocations: {
                    meeting: 0.25,
                    tea_break: 0.25,
                    lunch: 0.5,
                    housekeeping: 0.5,
                    total: 1.5
                },
                available_for_logging: schedule.available_productive_hours,
                notes: 'Fixed allocations are handled by the system. Technicians log only meaningful work activities.'
            };
        } catch (error) {
            console.error('Error getting time allocation summary:', error);
            throw error;
        }
    }
}

module.exports = TimeAllocationService;
