const mongoose = require('mongoose');

// Individual pause/resume event
const pauseResumeEventSchema = new mongoose.Schema({
    paused_at: {
        type: Date,
        required: true
    },
    resumed_at: Date,
    reason: {
        type: String,
        enum: [
            'Waiting for Parts',
            'Equipment Malfunction',
            'Lack of Tools',
            'Unclear Instructions',
            'Waiting for Approval',
            'Weather Conditions',
            'Resource Unavailable',
            'Other'
        ],
        required: true
    },
    description: String,
    // Calculated when resumed
    downtime_minutes: Number,
    downtime_hours: Number
}, { _id: false });

const downtimeLogSchema = new mongoose.Schema({
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
    technician_name: {
        type: String,
        required: true
    },
    
    // Job reference
    job_id: {
        type: String,
        required: true,
        index: true
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
    
    // Date
    date: {
        type: Date,
        required: true,
        index: true
    },
    
    // Pause/resume events
    pause_resume_events: {
        type: [pauseResumeEventSchema],
        default: []
    },
    
    // Totals per day
    total_pause_count: {
        type: Number,
        default: 0,
        min: 0
    },
    total_downtime_minutes: {
        type: Number,
        default: 0,
        min: 0
    },
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
    
    // Most common reason
    primary_reason: String,
    
    // Job allocation protection
    allocated_job_hours_before_pause: {
        type: Number,
        default: 0,
        min: 0
    },
    allocated_job_hours_after_pause: {
        type: Number,
        default: 0,
        min: 0
    },
    note: {
        type: String,
        default: 'IMPORTANT: Downtime does NOT reduce allocated job hours'
    },
    
    // Status
    is_active: {
        type: Boolean,
        default: false
    },
    is_resolved: {
        type: Boolean,
        default: false
    },
    
    // Related entries
    day_entry_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DayEntry',
        default: null
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
        { supervisor_key: 1, technician_id: 1, date: 1 },
        { job_id: 1, technician_id: 1, date: 1 },
        { is_active: 1, supervisor_key: 1 },
        { date: 1, supervisor_key: 1 }
    ]
});

// Pre-save hook to calculate totals
downtimeLogSchema.pre('save', function(next) {
    if (this.pause_resume_events && this.pause_resume_events.length > 0) {
        this.total_pause_count = this.pause_resume_events.length;
        
        let totalMinutes = 0;
        const reasons = [];
        
        this.pause_resume_events.forEach(event => {
            if (event.resumed_at) {
                const duration = new Date(event.resumed_at) - new Date(event.paused_at);
                const minutes = Math.floor(duration / 60000);
                event.downtime_minutes = minutes;
                event.downtime_hours = (minutes / 60).toFixed(2);
                totalMinutes += minutes;
            }
            if (event.reason) {
                reasons.push(event.reason);
            }
        });
        
        this.total_downtime_minutes = totalMinutes;
        this.total_downtime_hours = parseFloat((totalMinutes / 60).toFixed(2));
        this.total_downtime_days = parseFloat((totalMinutes / (24 * 60)).toFixed(4));
        
        // Most common reason
        if (reasons.length > 0) {
            const reasonCounts = {};
            reasons.forEach(r => {
                reasonCounts[r] = (reasonCounts[r] || 0) + 1;
            });
            this.primary_reason = Object.keys(reasonCounts).reduce((a, b) => 
                reasonCounts[a] > reasonCounts[b] ? a : b
            );
        }
    }
    
    next();
});

module.exports = mongoose.model('DowntimeLog', downtimeLogSchema);
