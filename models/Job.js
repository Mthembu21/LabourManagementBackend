const mongoose = require('mongoose');

const technicianAssignmentSchema = new mongoose.Schema({
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true
    },
    technician_name: {
        type: String,
        required: true
    },
    confirmed_by_technician: {
        type: Boolean,
        default: false
    },
    confirmed_date: Date,
    consumed_hours: {
        type: Number,
        default: 0
    }
}, { _id: false });

const subtaskProgressSchema = new mongoose.Schema({
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true
    },
    progress_percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const subtaskSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    weight: {
        type: Number,
        default: 1,
        min: 0
    },
    progress_by_technician: {
        type: [subtaskProgressSchema],
        default: []
    }
}, { timestamps: true });

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
    technicians: {
        type: [technicianAssignmentSchema],
        default: []
    },
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
    subtasks: {
        type: [subtaskSchema],
        default: []
    },
    bottleneck_count: {
        type: Number,
        default: 0
    },
    start_date: Date,
    target_completion_date: Date,
    actual_completion_date: Date,
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