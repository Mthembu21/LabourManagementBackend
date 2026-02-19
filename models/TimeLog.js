const mongoose = require('mongoose');

const IDLE_CATEGORIES = [
    'Housekeeping',
    'Sick',
    'Training',
    'Travelling',
    'Site Work'
];

const timeLogSchema = new mongoose.Schema({
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
    is_idle: {
        type: Boolean,
        default: false,
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
    }
}, {
    timestamps: true
});

// Prevent duplicate log entries for same technician + job + date
// (editing should use update endpoint)
timeLogSchema.index(
    { technician_id: 1, job_id: 1, log_date: 1 },
    { unique: true }
);

timeLogSchema.statics.IDLE_CATEGORIES = IDLE_CATEGORIES;

timeLogSchema.statics.normalizeLogDate = (dateObj) => {
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);
    return d;
};

module.exports = mongoose.model('TimeLog', timeLogSchema);
