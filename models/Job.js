const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
    job_number: {
        type: String,
        required: true,
        unique: true
    },
    description: {
        type: String,
        required: true
    },
    assigned_technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true
    },
    assigned_technician_name: String,
    allocated_hours: {
        type: Number,
        required: true
    },
    consumed_hours: {
        type: Number,
        default: 0
    },
    remaining_hours: Number,
    progress_percentage: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['pending_confirmation', 'active', 'in_progress', 'completed', 'at_risk', 'over_allocated'],
        default: 'pending_confirmation'
    },
    bottleneck_count: {
        type: Number,
        default: 0
    },
    start_date: Date,
    target_completion_date: Date,
    actual_completion_date: Date,
    confirmed_by_technician: {
        type: Boolean,
        default: false
    },
    confirmed_date: Date,
    total_hours_utilized: {
        type: Number,
        default: 0
    },
    reassignment_history: [{
        from_technician_id: String,
        from_technician_name: String,
        to_technician_id: String,
        to_technician_name: String,
        reassigned_date: String,
        reason: String
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Job', jobSchema);