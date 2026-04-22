const mongoose = require('mongoose');

const temporaryAssignmentSchema = new mongoose.Schema({
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true
    },
    original_supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis'],
        required: true
    },
    temporary_supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis'],
        required: true
    },
    assigned_at: {
        type: Date,
        default: Date.now
    },
    duration_hours: {
        type: Number,
        default: 8,
        min: 1,
        max: 24
    },
    reason: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'completed', 'expired'],
        default: 'active'
    },
    expires_at: {
        type: Date,
        required: true
    },
    // Track work done during temporary assignment
    total_hours_logged: {
        type: Number,
        default: 0
    },
    jobs_completed: {
        type: Number,
        default: 0
    },
    performance_notes: [{
        date: Date,
        note: String,
        job_id: String,
        hours_contributed: Number
    }]
}, {
    timestamps: true
});

// Index for efficient queries
temporaryAssignmentSchema.index({ technician_id: 1, status: 1 });
temporaryAssignmentSchema.index({ temporary_supervisor_key: 1, status: 1 });
temporaryAssignmentSchema.index({ expires_at: 1 });

// Virtual for checking if assignment is still valid
temporaryAssignmentSchema.virtual('isExpired').get(function() {
    return new Date() > this.expires_at;
});

// Pre-save middleware to update expires_at based on duration
temporaryAssignmentSchema.pre('save', function(next) {
    if (this.isNew && !this.expires_at) {
        const expiresAt = new Date(this.assigned_at.getTime() + (this.duration_hours * 60 * 60 * 1000));
        this.expires_at = expiresAt;
        this.markModified('expires_at'); // Ensure the field is marked as modified
        console.log('Setting expires_at:', expiresAt);
    }
    next();
});

module.exports = mongoose.model('TemporaryAssignment', temporaryAssignmentSchema);
