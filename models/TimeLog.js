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

// Strict time classification system for operational planning
const TIME_CATEGORIES = {
    PRODUCTIVE: 'productive',           // Job/work order booked hours (value-adding)
    NON_PRODUCTIVE: 'non_productive',  // Training, housekeeping, admin, waiting for parts, unbookable work
    IDLE: 'idle',                      // No work assigned (capacity loss)
    NOT_AVAILABLE: 'not_available'     // Leave, sick
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
    is_leave: {
        type: Boolean,
        default: false,
        index: true
    },
    hour_category: {
        type: String,
        enum: [...Object.values(TIME_CATEGORIES), null],
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
    },
    // Temporary assignment context for cross-supervisor tracking
    temporary_assignment_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TemporaryAssignment',
        default: null
    },
    is_temporary_assignment: {
        type: Boolean,
        default: false,
        index: true
    },
    original_supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis', null],
        default: null
    },
    time_category: {
        type: String,
        enum: Object.values(TIME_CATEGORIES),
        required: true,
        default: 'productive',
        index: true
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
timeLogSchema.statics.TIME_CATEGORIES = TIME_CATEGORIES;

timeLogSchema.statics.normalizeLogDate = (dateObj) => {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Determine time category based on entry data (strict classification)
timeLogSchema.statics.determineTimeCategory = (entry) => {
    // Productive: Job/work order booked hours (not idle)
    if (!entry.is_idle && entry.job_id && entry.category !== 'Housekeeping') {
        return TIME_CATEGORIES.PRODUCTIVE;
    }
    
    // Not Available: Leave, Sick
    if (entry.is_leave || ['Leave', 'Sick'].includes(entry.category)) {
        return TIME_CATEGORIES.NOT_AVAILABLE;
    }
    
    // Non-Productive: Training, Housekeeping, admin, waiting for parts, unbookable work
    if (['Training', 'Housekeeping', 'Admin', 'Waiting for Parts', 'Site Work'].includes(entry.category)) {
        return TIME_CATEGORIES.NON_PRODUCTIVE;
    }
    
    // Idle: No work assigned (capacity loss)
    return TIME_CATEGORIES.IDLE;
};

// Calculate utilization and productivity metrics using new operational principles
timeLogSchema.statics.calculateOperationalMetrics = async (supervisorKey, technicianId, startDate, endDate, totalContractedHours = null) => {
    const TimeLog = mongoose.model('TimeLog');
    
    const entries = await TimeLog.find({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        log_date: { $gte: startDate, $lte: endDate }
    });

    // Calculate hours by category
    let productiveHours = 0;
    let nonProductiveHours = 0;
    let idleHours = 0;
    let notAvailableHours = 0;

    entries.forEach(entry => {
        const hours = Number(entry.hours_logged || 0);
        const category = entry.time_category || TimeLog.determineTimeCategory(entry);
        
        switch (category) {
            case TIME_CATEGORIES.PRODUCTIVE:
                productiveHours += hours;
                break;
            case TIME_CATEGORIES.NON_PRODUCTIVE:
                nonProductiveHours += hours;
                break;
            case TIME_CATEGORIES.IDLE:
                idleHours += hours;
                break;
            case TIME_CATEGORIES.NOT_AVAILABLE:
                notAvailableHours += hours;
                break;
        }
    });

    // Total Contracted Hours (provided or calculated)
    if (totalContractedHours === null) {
        // Default to sum of all logged hours if not provided
        totalContractedHours = productiveHours + nonProductiveHours + idleHours + notAvailableHours;
    }

    // Adjusted Available Hours = Total Contracted Hours - Not Available Hours
    const adjustedAvailableHours = totalContractedHours - notAvailableHours;

    // A. Utilization % = Productive Hours / Adjusted Available Hours * 100
    const utilization = adjustedAvailableHours > 0 ? (productiveHours / adjustedAvailableHours) * 100 : 0;

    // B. Productivity % = Productive Hours / (Productive Hours + Non-Productive Hours) * 100
    const workingHours = productiveHours + nonProductiveHours;
    const productivity = workingHours > 0 ? (productiveHours / workingHours) * 100 : 0;

    // C. Idle % = Idle Hours / Adjusted Available Hours * 100
    const idlePercentage = adjustedAvailableHours > 0 ? (idleHours / adjustedAvailableHours) * 100 : 0;

    // D. Total Productivity (Finance View) = Productive Hours / Total Contracted Hours * 100
    const totalProductivity = totalContractedHours > 0 ? (productiveHours / totalContractedHours) * 100 : 0;

    return {
        productiveHours,
        nonProductiveHours,
        idleHours,
        notAvailableHours,
        totalContractedHours,
        adjustedAvailableHours,
        workingHours,
        utilization,
        productivity,
        idlePercentage,
        totalProductivity
    };
};

// Calculate daily operational metrics using new TimeCategory system
timeLogSchema.statics.calculateDailyOperationalMetrics = async (supervisorKey, technicianId, startDate, endDate) => {
    const TimeLog = mongoose.model('TimeLog');
    const { eachDayOfInterval } = require('date-fns');
    
    console.log('🔍 Backend calculateDailyOperationalMetrics called:', {
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
        
        // Categorize hours using new TimeCategory system
        let totalHours = 0;
        let productiveHours = 0;
        let nonProductiveHours = 0;
        let idleHours = 0;
        let notAvailableHours = 0;
        let trainingHours = 0;
        let housekeepingHours = 0;
        
        entries.forEach(entry => {
            const hours = Number(entry.hours_logged || 0);
            totalHours += hours;
            
            const category = entry.time_category || TimeLog.determineTimeCategory(entry);
            
            switch (category) {
                case TIME_CATEGORIES.PRODUCTIVE:
                    productiveHours += hours;
                    break;
                case TIME_CATEGORIES.NON_PRODUCTIVE:
                    nonProductiveHours += hours;
                    // Track specific categories
                    if (entry.category === 'Training') {
                        trainingHours += hours;
                    } else if (entry.category === 'Housekeeping') {
                        housekeepingHours += hours;
                    }
                    break;
                case TIME_CATEGORIES.IDLE:
                    idleHours += hours;
                    break;
                case TIME_CATEGORIES.NOT_AVAILABLE:
                    notAvailableHours += hours;
                    break;
            }
        });
        
        // New operational principles for daily calculations
        const totalContractedHours = totalHours; // All logged hours for this day
        const adjustedAvailableHours = totalContractedHours - notAvailableHours;
        
        // A. Utilization % = Productive Hours / Adjusted Available Hours * 100
        const utilization = adjustedAvailableHours > 0 ? (productiveHours / adjustedAvailableHours) * 100 : 0;
        
        // B. Productivity % = Productive Hours / (Productive Hours + Non-Productive Hours) * 100
        const workingHours = productiveHours + nonProductiveHours;
        const productivity = workingHours > 0 ? (productiveHours / workingHours) * 100 : 0;
        
        // C. Idle % = Idle Hours / Adjusted Available Hours * 100
        const idlePercentage = adjustedAvailableHours > 0 ? (idleHours / adjustedAvailableHours) * 100 : 0;
        
        // D. Total Productivity (Finance View) = Productive Hours / Total Contracted Hours * 100
        const totalProductivity = totalContractedHours > 0 ? (productiveHours / totalContractedHours) * 100 : 0;
        
        // Legacy compatibility - keep old variable names for existing frontend code
        const availableHours = adjustedAvailableHours;
        const effectiveProductivity = productivity;
        
        dailyData.push({
            date: day,
            totalHours,
            productiveHours,
            nonProductiveHours,
            idleHours,
            notAvailableHours,
            totalContractedHours,
            adjustedAvailableHours,
            workingHours,
            utilization,
            productivity,
            idlePercentage,
            totalProductivity,
            // Legacy compatibility for existing frontend
            availableHours,
            unavailableHours: notAvailableHours,
            utilizationLossHours: idleHours,
            trainingHours,
            housekeepingHours,
            effectiveProductivity: productivity,
            lunchHoursDeduction: 0,
            effectiveJobHours: productiveHours,
            totalAvailableWorkTime: adjustedAvailableHours,
            productivePercentage: adjustedAvailableHours > 0 ? (productiveHours / adjustedAvailableHours) * 100 : 0,
            housekeepingPercentage: adjustedAvailableHours > 0 ? (housekeepingHours / adjustedAvailableHours) * 100 : 0,
            trainingPercentage: adjustedAvailableHours > 0 ? (trainingHours / adjustedAvailableHours) * 100 : 0,
            timeEntries: entries.map(entry => ({
                date: entry.log_date,
                jobId: entry.job_id,
                hours: entry.hours_logged,
                isProductive: !entry.is_idle,
                category: entry.category
            }))
        });
    }
    
    console.log('🔍 Backend returning dailyData:', dailyData);
    return dailyData.filter(d => d.availableHours > 0); // Filter out days with no available hours
};

module.exports = mongoose.model('TimeLog', timeLogSchema);
