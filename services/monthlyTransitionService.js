const MonthlyHoursSummary = require('../models/MonthlyHoursSummary');
const TimeLog = require('../models/TimeLog');

class MonthlyTransitionService {
    static async checkAndTransitionMonth(supervisorKey) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        // Check if we have any current month summaries
        const currentMonthSummaries = await MonthlyHoursSummary.find({
            supervisor_key: supervisorKey,
            year: currentYear,
            month: currentMonth
        });
        
        // If we already have current month data, no transition needed
        if (currentMonthSummaries.length > 0) {
            return {
                transitioned: false,
                message: 'Current month data already exists'
            };
        }
        
        // Get previous month data to preserve historical records
        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
        
        const previousMonthSummaries = await MonthlyHoursSummary.find({
            supervisor_key: supervisorKey,
            year: lastMonthYear,
            month: lastMonth
        });
        
        // Archive previous month data (already stored, just ensure it's complete)
        await this.finalizePreviousMonth(supervisorKey, lastMonthYear, lastMonth);
        
        // Clear any existing current month summaries (should be none, but just in case)
        await MonthlyHoursSummary.deleteMany({
            supervisor_key: supervisorKey,
            year: currentYear,
            month: currentMonth
        });
        
        return {
            transitioned: true,
            message: 'Successfully transitioned to new month',
            previousMonthData: {
                year: lastMonthYear,
                month: lastMonth,
                summariesCount: previousMonthSummaries.length
            }
        };
    }
    
    static async finalizePreviousMonth(supervisorKey, year, month) {
        // Ensure all time entries for the previous month are properly summarized
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59, 999);
        
        // Get all time entries for the previous month
        const timeEntries = await TimeLog.find({
            supervisor_key: supervisorKey,
            log_date: { $gte: startDate, $lte: endDate }
        });
        
        // Group by technician
        const entriesByTechnician = {};
        timeEntries.forEach(entry => {
            const techId = entry.technician_id.toString();
            if (!entriesByTechnician[techId]) {
                entriesByTechnician[techId] = [];
            }
            entriesByTechnician[techId].push(entry);
        });
        
        // Update or create monthly summaries for each technician
        for (const [technicianId, entries] of Object.entries(entriesByTechnician)) {
            let summary = await MonthlyHoursSummary.findOne({
                supervisor_key: supervisorKey,
                technician_id: technicianId,
                year: year,
                month: month
            });
            
            if (!summary) {
                summary = new MonthlyHoursSummary({
                    supervisor_key: supervisorKey,
                    technician_id: technicianId,
                    year: year,
                    month: month
                });
            }
            
            // Recalculate all totals from time entries
            summary.total_hours = 0;
            summary.productive_hours = 0;
            summary.non_productive_hours = 0;
            summary.normal_hours = 0;
            summary.overtime_hours = 0;
            summary.weighted_overtime_hours = 0;
            
            entries.forEach(entry => {
                summary.total_hours += Number(entry.hours_logged || 0);
                
                if (entry.is_idle) {
                    summary.non_productive_hours += Number(entry.hours_logged || 0);
                } else {
                    summary.productive_hours += Number(entry.hours_logged || 0);
                }
                
                summary.normal_hours += Number(entry.normal_hours || 0);
                summary.overtime_hours += Number(entry.overtime_hours || 0);
                summary.weighted_overtime_hours += Number(entry.payable_hours || 0) - Number(entry.hours_logged || 0);
            });
            
            // Recalculate derived metrics
            summary.total_days_worked = await MonthlyHoursSummary.calculateDaysWorked(
                supervisorKey, technicianId, year, month
            );
            summary.average_hours_per_day = summary.total_days_worked > 0 ? summary.total_hours / summary.total_days_worked : 0;
            
            // ✅ Utilization = Productive / (Productive + Idle + Housekeeping) * 100 (exclude training & leave)
            // Note: This assumes summary has separate fields for idle and housekeeping hours
            const availableHours = summary.productive_hours + (summary.idle_hours || 0) + (summary.housekeeping_hours || 0);
            summary.utilization_percentage = availableHours > 0 ? (summary.productive_hours / availableHours) * 100 : 0;
            
            summary.last_updated = new Date();
            await summary.save();
        }
        
        return {
            finalized: true,
            techniciansProcessed: Object.keys(entriesByTechnician).length,
            totalEntries: timeEntries.length
        };
    }
    
    static async getCurrentMonthStatus(supervisorKey) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        const currentSummaries = await MonthlyHoursSummary.find({
            supervisor_key: supervisorKey,
            year: currentYear,
            month: currentMonth
        });
        
        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
        
        const previousSummaries = await MonthlyHoursSummary.find({
            supervisor_key: supervisorKey,
            year: lastMonthYear,
            month: lastMonth
        });
        
        return {
            currentMonth: {
                year: currentYear,
                month: currentMonth,
                hasData: currentSummaries.length > 0,
                summaryCount: currentSummaries.length
            },
            previousMonth: {
                year: lastMonthYear,
                month: lastMonth,
                hasData: previousSummaries.length > 0,
                summaryCount: previousSummaries.length
            },
            needsTransition: currentSummaries.length === 0 && previousSummaries.length > 0
        };
    }
    
    static async forceTransitionToCurrentMonth(supervisorKey, technicianIds = null) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        let filter = {
            supervisor_key: supervisorKey,
            year: currentYear,
            month: currentMonth
        };
        
        if (technicianIds && technicianIds.length > 0) {
            filter.technician_id = { $in: technicianIds };
        }
        
        const result = await MonthlyHoursSummary.deleteMany(filter);
        
        return {
            message: 'Current month summaries cleared successfully',
            deletedCount: result.deletedCount,
            clearedMonth: {
                year: currentYear,
                month: currentMonth
            }
        };
    }
}

module.exports = MonthlyTransitionService;
