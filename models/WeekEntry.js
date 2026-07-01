const mongoose = require('mongoose');

// Aggregated daily record for a week
const weekDayAggregateSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true
    },
    day_of_week: String,
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
    idle_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    overtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    downtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    leave_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    available_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    available_productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    jobs_count: {
        type: Number,
        default: 0
    }
}, { _id: false });

// Main week entry schema
const weekEntrySchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis', 'kathu'],
        default: 'component',
        index: true
    },
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true,
        index: true
    },
    technician_name: {
        type: String,
        required: true
    },
    
    // Week identifier
    week_number: {
        type: Number,
        required: true,
        min: 1,
        max: 53
    },
    year: {
        type: Number,
        required: true
    },
    week_start_date: {
        type: Date,
        required: true,
        index: true
    },
    week_end_date: {
        type: Date,
        required: true
    },
    
    // Daily aggregates (Monday to Friday)
    daily_records: {
        type: [weekDayAggregateSchema],
        default: []
    },
    
    // Weekly totals
    total_productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_non_productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_idle_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_overtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_downtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_leave_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_scheduled_hours: {
        type: Number,
        default: 37.5,
        min: 0
    },
    total_available_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_available_productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },

    // KPI snapshots
    weekly_utilization_percent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    weekly_productivity_percent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    weekly_efficiency_percent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    
    // Active jobs during week
    active_jobs: [{
        job_id: String,
        job_number: String,
        status: String
    }],
    
    // Completed jobs during week
    completed_jobs: [{
        job_id: String,
        job_number: String,
        completion_date: Date,
        total_hours_spent: Number
    }],
    
    // Status
    week_status: {
        type: String,
        enum: ['draft', 'submitted', 'approved', 'locked'],
        default: 'draft'
    },
    supervisor_approved: {
        type: Boolean,
        default: false
    },
    approved_by: String,
    approval_date: Date,
    
    // Audit
    is_migrated: {
        type: Boolean,
        default: false
    },
    
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    indexes: [
        { supervisor_key: 1, technician_id: 1, year: 1, week_number: 1 },
        { week_start_date: 1, supervisor_key: 1 },
        { technician_id: 1, year: 1, week_number: 1 }
    ]
});

// Unique constraint on week per technician per supervisor
weekEntrySchema.index(
    { supervisor_key: 1, technician_id: 1, year: 1, week_number: 1 },
    { unique: true }
);

// Pre-save hook to recalculate totals from daily records
weekEntrySchema.pre('save', function(next) {
    if (this.daily_records && this.daily_records.length > 0) {
        this.total_productive_hours = this.daily_records.reduce((sum, day) => sum + (day.productive_hours || 0), 0);
        this.total_non_productive_hours = this.daily_records.reduce((sum, day) => sum + (day.non_productive_hours || 0), 0);
        this.total_idle_hours = this.daily_records.reduce((sum, day) => sum + (day.idle_hours || 0), 0);
        this.total_overtime_hours = this.daily_records.reduce((sum, day) => sum + (day.overtime_hours || 0), 0);
        this.total_downtime_hours = this.daily_records.reduce((sum, day) => sum + (day.downtime_hours || 0), 0);
        this.total_leave_hours = this.daily_records.reduce((sum, day) => sum + (day.leave_hours || 0), 0);
        this.total_available_hours = this.daily_records.reduce((sum, day) => sum + (day.available_hours || 0), 0);
        this.total_available_productive_hours = this.daily_records.reduce((sum, day) => sum + (day.available_productive_hours || 0), 0);
    }

    next();
});

module.exports = mongoose.model('WeekEntry', weekEntrySchema);
