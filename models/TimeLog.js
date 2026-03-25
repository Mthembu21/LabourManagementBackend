const mongoose = require('mongoose');

const IDLE_CATEGORIES = [
    'Housekeeping',
    'Sick',
    'Leave',
    'Training',
    'Travelling',
    'Site Work',
    'Other'
];

// Hour categories for utilization calculation
const HOUR_CATEGORIES = {
    PRODUCTIVE: 'productive',
    UNAVAILABLE: 'unavailable', // Training, Leave, Sick - reduces available hours but not utilization
    UTILIZATION_LOSS: 'utilization_loss' // Idle Time, Housekeeping - reduces utilization
};

const timeLogSchema = new mongoose.Schema({
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
    job_id: {
        type: String,
        required: true,
        index: true
    },
    subtask_id: {
        type: String,
        default: null,
        index: true
    },
    subtask_title: {
        type: String,
        default: null
    },
    hours_logged: {
        type: Number,
        required: true,
        min: 0
    },
    log_date: {
        type: Date,
        required: true,
        index: true
    },
    category: {
        type: String,
        enum: [...IDLE_CATEGORIES, null],
        default: null
    },
    category_detail: {
        type: String,
        default: ''
    },
    is_idle: {
        type: Boolean,
        default: false,
        index: true
    },
    hour_category: {
        type: String,
        enum: Object.values(HOUR_CATEGORIES),
        default: null,
        index: true
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
    is_public_holiday: {
        type: Boolean,
        default: false,
        index: true
    },
    public_holiday_name: {
        type: String,
        default: null
    },
    overtime_multiplier: {
        type: Number,
        default: 1,
        min: 1
    },
    payable_hours: {
        type: Number,
        default: 0,
        min: 0
    },

    approval_status: {
        type: String,
        enum: ['pending', 'approved', 'declined'],
        default: 'approved',
        index: true
    },
    approved_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    approved_by: {
        type: String,
        default: null
    },
    approved_at: {
        type: Date,
        default: null
    },
    approval_note: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Prevent duplicate log entries for same technician + job + date
// (editing should use update endpoint)
timeLogSchema.index(
    { technician_id: 1, job_id: 1, subtask_id: 1, log_date: 1 },
    { unique: true }
);

timeLogSchema.index(
    { supervisor_key: 1, technician_id: 1, log_date: 1 }
);

timeLogSchema.statics.IDLE_CATEGORIES = IDLE_CATEGORIES;
timeLogSchema.statics.HOUR_CATEGORIES = HOUR_CATEGORIES;

timeLogSchema.statics.normalizeLogDate = (dateObj) => {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Determine hour category based on entry data
timeLogSchema.statics.determineHourCategory = (entry) => {
    if (!entry.is_idle) {
        return HOUR_CATEGORIES.PRODUCTIVE;
    }
    
    // For idle entries, categorize based on category
    const category = entry.category;
    if (['Training', 'Leave', 'Sick'].includes(category)) {
        return HOUR_CATEGORIES.UNAVAILABLE;
    }
    
    // Housekeeping and other idle categories are utilization loss
    return HOUR_CATEGORIES.UTILIZATION_LOSS;
};

// Calculate utilization for a technician within a date range
timeLogSchema.statics.calculateUtilization = async (supervisorKey, technicianId, startDate, endDate) => {
    const TimeLog = mongoose.model('TimeLog');
    
    const entries = await TimeLog.find({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        log_date: { $gte: startDate, $lte: endDate }
    });
    
    let totalHours = 0;
    let productiveHours = 0;
    let unavailableHours = 0;
    let utilizationLossHours = 0;
    
    entries.forEach(entry => {
        const hours = Number(entry.hours_logged || 0);
        totalHours += hours;
        
        const category = TimeLog.determineHourCategory(entry);
        
        switch (category) {
            case HOUR_CATEGORIES.PRODUCTIVE:
                productiveHours += hours;
                break;
            case HOUR_CATEGORIES.UNAVAILABLE:
                unavailableHours += hours;
                break;
            case HOUR_CATEGORIES.UTILIZATION_LOSS:
                utilizationLossHours += hours;
                break;
        }
    });
    
    const availableHours = totalHours - unavailableHours;
    const utilization = availableHours > 0 ? (productiveHours / availableHours) * 100 : 0;
    
    return {
        totalHours,
        productiveHours,
        unavailableHours,
        utilizationLossHours,
        availableHours,
        utilization: Math.max(0, Math.min(100, utilization))
    };
};

// Calculate daily productive percentages for a technician with detailed breakdowns
timeLogSchema.statics.calculateDailyProductivity = async (supervisorKey, technicianId, startDate, endDate) => {
    const TimeLog = mongoose.model('TimeLog');
    const { eachDayOfInterval } = require('date-fns');
    
    console.log('🔍 Backend calculateDailyProductivity called:', {
        supervisorKey,
        technicianId,
        startDate,
        endDate
    });
    
    const dailyData = [];
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    
    for (const day of days) {
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);
        
        const entries = await TimeLog.find({
            supervisor_key: supervisorKey,
            technician_id: technicianId,
            log_date: { $gte: dayStart, $lte: dayEnd }
        });
        
        console.log(`🔍 Day ${day.toISOString()} has ${entries.length} entries for technician ${technicianId}`);
        
        // Categorize hours
        let totalHours = 0;
        let productiveHours = 0;
        let unavailableHours = 0;
        let utilizationLossHours = 0;
        let trainingHours = 0;
        let idleHours = 0;
        let housekeepingHours = 0;
        
        entries.forEach(entry => {
            const hours = Number(entry.hours_logged || 0);
            totalHours += hours;
            
            const category = TimeLog.determineHourCategory(entry);
            
            switch (category) {
                case HOUR_CATEGORIES.PRODUCTIVE:
                    productiveHours += hours;
                    break;
                case HOUR_CATEGORIES.UNAVAILABLE:
                    unavailableHours += hours;
                    if (entry.category === 'Training') {
                        trainingHours += hours;
                    }
                    break;
                case HOUR_CATEGORIES.UTILIZATION_LOSS:
                    utilizationLossHours += hours;
                    if (entry.category === 'Housekeeping') {
                        housekeepingHours += hours;
                    } else {
                        idleHours += hours;
                    }
                    break;
            }
        });
        
        // ✅ Available Hours = Productive + Idle + Housekeeping (exclude training & leave)
        const availableHours = productiveHours + idleHours + housekeepingHours;
        
        // ✅ Utilization = Productive / Available * 100 (exclude training & leave)
        const utilization = availableHours > 0 ? (productiveHours / availableHours) * 100 : 0;
        
        // ✅ Productivity = Productive / Total Logged * 100 (includes all recorded hours)
        const totalLogged = productiveHours + idleHours + housekeepingHours + trainingHours;
        const productivity = totalLogged > 0 ? (productiveHours / totalLogged) * 100 : 0;
        
        // Calculate percentages for tooltip breakdowns (all based on total logged hours)
        const productivePercentage = totalLogged > 0 ? (productiveHours / totalLogged) * 100 : 0;
        const idlePercentage = totalLogged > 0 ? (idleHours / totalLogged) * 100 : 0;
        const housekeepingPercentage = totalLogged > 0 ? (housekeepingHours / totalLogged) * 100 : 0;
        const trainingPercentage = totalLogged > 0 ? (trainingHours / totalLogged) * 100 : 0;
        
        dailyData.push({
            date: day,
            totalHours,
            productiveHours,
            availableHours,
            unavailableHours,
            utilizationLossHours,
            trainingHours,
            idleHours,
            housekeepingHours,
            dailyProductivePercentage: productivity,
            dailyUtilizationPercentage: utilization,
            breakdown: {
                productivePercentage: Math.max(0, Math.min(100, productivePercentage)),
                idlePercentage: Math.max(0, Math.min(100, idlePercentage)),
                housekeepingPercentage: Math.max(0, Math.min(100, housekeepingPercentage)),
                trainingPercentage: Math.max(0, Math.min(100, trainingPercentage))
            }
        });
    }
    
    console.log('🔍 Backend returning dailyData:', dailyData);
    return dailyData.filter(d => d.availableHours > 0); // Filter out days with no available hours
};

module.exports = mongoose.model('TimeLog', timeLogSchema);
