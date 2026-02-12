const mongoose = require('mongoose');

const dailyTimeEntrySchema = new mongoose.Schema({
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true
    },
    technician_name: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    day_of_week: String,
    job_id: {
        type: String,
        required: true
    },
    job_number: String,
    hr_hours: {
        type: Number,
        default: 0
    },
    productive_hours: {
        type: Number,
        default: 0
    },
    start_time: String,
    end_time: String,
    overtime_hours: {
        type: Number,
        default: 0
    },
    overtime_rate: {
        type: Number,
        default: 1.5
    },
    weighted_overtime: {
        type: Number,
        default: 0
    },
    notes: String,
    supervisor_approved_excess: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('DailyTimeEntry', dailyTimeEntrySchema);