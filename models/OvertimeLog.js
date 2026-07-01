const mongoose = require('mongoose');

const overtimeLogSchema = new mongoose.Schema({
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
    
    // Overtime details
    date: {
        type: Date,
        required: true,
        index: true
    },
    day_of_week: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    },
    
    // Hours logged
    overtime_hours: {
        type: Number,
        required: true,
        min: 0.5
    },
    overtime_rate: {
        type: Number,
        default: 1.5,
        min: 1,
        max: 3
    },
    
    // Calculated payable hours
    payable_hours: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Reason for overtime
    reason: {
        type: String,
        enum: [
            'Job Deadline',
            'Urgent Repair',
            'Customer Request',
            'Resource Shortage',
            'Technical Complexity',
            'Preventive Maintenance',
            'Other'
        ],
        required: true
    },
    description: String,
    
    // Logging details
    logged_by: {
        type: String,
        required: true,
        enum: ['technician', 'supervisor', 'planner']
    },
    logged_at: {
        type: Date,
        default: Date.now
    },
    
    // Approval
    approval_status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    approved_by: String,
    approved_date: Date,
    approval_notes: String,
    
    // Track if manually or system-calculated
    is_manually_logged: {
        type: Boolean,
        default: true
    },
    
    // Status
    overtime_status: {
        type: String,
        enum: ['logged', 'approved', 'paid', 'rejected'],
        default: 'logged'
    },
    
    // Related entries
    day_entry_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DayEntry',
        default: null
    },
    time_log_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TimeLog',
        default: null
    },
    
    // Notes
    notes: String,
    
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
        { approval_status: 1, supervisor_key: 1 },
        { date: 1, supervisor_key: 1 },
        { technician_id: 1, overtime_status: 1 }
    ]
});

// Pre-save hook to calculate payable hours
overtimeLogSchema.pre('save', function(next) {
    this.payable_hours = parseFloat((this.overtime_hours * this.overtime_rate).toFixed(2));
    next();
});

module.exports = mongoose.model('OvertimeLog', overtimeLogSchema);
