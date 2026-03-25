const mongoose = require('mongoose');

const monthlyHoursSummarySchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis'],
        default: 'component',
        index: true
    },
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true,
        index: true
    },
    year: {
        type: Number,
        required: true,
        index: true
    },
    month: {
        type: Number,
        required: true, // 1-12
        index: true
    },
    
    // Hours breakdown
    total_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    non_productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    normal_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    overtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    weighted_overtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Additional metrics
    total_days_worked: {
        type: Number,
        default: 0,
        min: 0
    },
    average_hours_per_day: {
        type: Number,
        default: 0,
        min: 0
    },
    utilization_percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    
    // Timestamps
    summary_date: {
        type: Date,
        default: Date.now
    },
    last_updated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index for unique monthly records per technician
monthlyHoursSummarySchema.index(
    { supervisor_key: 1, technician_id: 1, year: 1, month: 1 },
    { unique: true }
);

// Static method to get or create monthly summary
monthlyHoursSummarySchema.statics.getOrCreateMonthlySummary = async function(supervisorKey, technicianId, year, month) {
    const summary = await this.findOne({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        year: year,
        month: month
    });
    
    if (summary) {
        return summary;
    }
    
    // Create new summary if not found
    return await this.create({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        year: year,
        month: month
    });
};

// Static method to update monthly summary with new time entry
monthlyHoursSummarySchema.statics.updateMonthlySummary = async function(supervisorKey, technicianId, year, month, timeEntryData) {
    const summary = await this.getOrCreateMonthlySummary(supervisorKey, technicianId, year, month);
    
    // Update hours
    summary.total_hours += Number(timeEntryData.hours_logged || 0);
    
    if (timeEntryData.is_idle) {
        summary.non_productive_hours += Number(timeEntryData.hours_logged || 0);
    } else {
        summary.productive_hours += Number(timeEntryData.hours_logged || 0);
    }
    
    summary.normal_hours += Number(timeEntryData.normal_hours || 0);
    summary.overtime_hours += Number(timeEntryData.overtime_hours || 0);
    summary.weighted_overtime_hours += Number(timeEntryData.payable_hours || 0) - Number(timeEntryData.hours_logged || 0);
    
    // Recalculate derived metrics
    summary.total_days_worked = await this.calculateDaysWorked(supervisorKey, technicianId, year, month);
    summary.average_hours_per_day = summary.total_days_worked > 0 ? summary.total_hours / summary.total_days_worked : 0;
    
    const totalRecordedHours = summary.productive_hours + summary.non_productive_hours;
    summary.utilization_percentage = totalRecordedHours > 0 ? (summary.productive_hours / totalRecordedHours) * 100 : 0;
    
    summary.last_updated = new Date();
    
    return await summary.save();
};

// Static method to calculate days worked in a month
monthlyHoursSummarySchema.statics.calculateDaysWorked = async function(supervisorKey, technicianId, year, month) {
    const TimeLog = mongoose.model('TimeLog');
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    
    const logs = await TimeLog.find({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        log_date: { $gte: startDate, $lte: endDate }
    });
    
    // Count unique days with any logged hours
    const uniqueDays = new Set();
    logs.forEach(log => {
        if (log.log_date) {
            const dayKey = log.log_date.toISOString().split('T')[0];
            uniqueDays.add(dayKey);
        }
    });
    
    return uniqueDays.size;
};

// Static method to get monthly summaries for a date range
monthlyHoursSummarySchema.statics.getSummariesForDateRange = async function(supervisorKey, technicianIds, startDate, endDate) {
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth() + 1;
    const endYear = endDate.getFullYear();
    const endMonth = endDate.getMonth() + 1;
    
    const query = {
        supervisor_key: supervisorKey,
        $or: []
    };
    
    // Build year/month combinations for the range
    for (let year = startYear; year <= endYear; year++) {
        const firstMonth = (year === startYear) ? startMonth : 1;
        const lastMonth = (year === endYear) ? endMonth : 12;
        
        for (let month = firstMonth; month <= lastMonth; month++) {
            query.$or.push({ year: year, month: month });
        }
    }
    
    if (technicianIds && technicianIds.length > 0) {
        query.technician_id = { $in: technicianIds };
    }
    
    return await this.find(query).sort({ year: -1, month: -1 });
};

module.exports = mongoose.model('MonthlyHoursSummary', monthlyHoursSummarySchema);
