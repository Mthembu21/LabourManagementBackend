const mongoose = require('mongoose');

// Individual job entry within a day
const jobEntrySchema = new mongoose.Schema({
    job_id: {
        type: String,
        required: true
    },
    job_number: String,
    subtask_id: {
        type: String,
        default: null
    },
    subtask_title: {
        type: String,
        default: null
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
    pause_resume_events: [{
        paused_at: Date,
        resumed_at: Date,
        reason: String,
        description: String,
        pause_duration_minutes: Number
    }],
    total_downtime_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    total_downtime_days: {
        type: Number,
        default: 0,
        min: 0
    },
    notes: String,
    job_status: {
        type: String,
        enum: ['active', 'paused', 'completed'],
        default: 'active'
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

// Main day entry schema
const dayEntrySchema = new mongoose.Schema({
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
    date: {
        type: Date,
        required: true,
        index: true
    },
    day_of_week: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        required: true
    },
    
    // Job entries for the day
    job_entries: {
        type: [jobEntrySchema],
        default: []
    },
    
    // Daily totals
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
    
    // Capacity tracking
    scheduled_hours: {
        type: Number,
        default: 7.5,
        min: 0
    },
    leave_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    available_productive_hours: {
        type: Number,
        default: 0,
        min: 0
    },

    // New time allocation model fields
    schedule_config_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WorkingDayScheduleConfig',
        default: null
    },

    is_leave_day: {
        type: Boolean,
        default: false,
        index: true
    },

    is_sick_day: {
        type: Boolean,
        default: false,
        index: true
    },

    attendance_record_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AttendanceRecord',
        default: null
    },

    system_allocated_non_productive_hours: {
        type: Number,
        default: 1.5,
        min: 0
    },
    
    // Status
    entry_status: {
        type: String,
        enum: ['draft', 'submitted', 'approved', 'rejected'],
        default: 'draft'
    },
    supervisor_approved: {
        type: Boolean,
        default: false
    },
    approved_by: String,
    approval_date: Date,
    approval_notes: String,
    
    // General notes for the day
    notes: String,
    
    // Audit fields
    is_migrated_from_legacy: {
        type: Boolean,
        default: false
    },
    legacy_daily_time_entry_id: mongoose.Schema.Types.ObjectId,
    
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
        { supervisor_key: 1, technician_id: 1, date: 1 },
        { date: 1, supervisor_key: 1 },
        { technician_id: 1, date: 1 }
    ]
});

// Pre-save hook to recalculate totals
dayEntrySchema.pre('save', function(next) {
    if (this.job_entries && this.job_entries.length > 0) {
        this.total_productive_hours = this.job_entries.reduce((sum, entry) => sum + (entry.productive_hours || 0), 0);
        this.total_non_productive_hours = this.job_entries.reduce((sum, entry) => sum + (entry.non_productive_hours || 0), 0);
        this.total_idle_hours = this.job_entries.reduce((sum, entry) => sum + (entry.idle_hours || 0), 0);
        this.total_overtime_hours = this.job_entries.reduce((sum, entry) => sum + (entry.overtime_hours || 0), 0);
        this.total_downtime_hours = this.job_entries.reduce((sum, entry) => sum + (entry.total_downtime_hours || 0), 0);
    }

    // Calculate available_productive_hours based on day type
    // Monday-Thursday: 8.5 scheduled - 1.5 fixed non-productive = 7 productive
    // Friday: 7 scheduled - 1.5 fixed non-productive = 5.5 productive
    // If leave/sick day (checked via AttendanceRecord), set to 0
    if (this.is_leave_day || this.is_sick_day) {
        this.available_productive_hours = 0;
    } else {
        // Determine scheduled hours based on day of week
        const isFriday = this.day_of_week === 'Friday';
        const baseScheduled = isFriday ? 7 : 8.5;

        // Subtract system-allocated non-productive hours (meetings, breaks, lunch, housekeeping)
        const systemAllocated = this.system_allocated_non_productive_hours || 1.5;

        // Result: productive hours after subtracting fixed non-productive and any leave
        const availableBeforeLeave = Math.max(0, baseScheduled - systemAllocated);
        this.available_productive_hours = Math.max(0, availableBeforeLeave - (this.leave_hours || 0));
    }

    next();
});

// Indexes for performance
dayEntrySchema.index({ supervisor_key: 1, technician_id: 1, date: 1 }, { unique: true });
dayEntrySchema.index({ date: 1, supervisor_key: 1 });
dayEntrySchema.index({ technician_id: 1, date: 1 });
dayEntrySchema.index({ entry_status: 1 });

module.exports = mongoose.model('DayEntry', dayEntrySchema);
