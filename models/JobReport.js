const mongoose = require('mongoose');

const jobReportSchema = new mongoose.Schema({
    job_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    job_number: String,
    technician_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Technician',
        required: true
    },
    technician_name: String,
    date: {
        type: Date,
        required: true
    },
    work_completed: {
        type: String,
        required: true
    },
    has_bottleneck: {
        type: Boolean,
        default: false
    },
    bottleneck_category: {
        type: String,
        enum: ['waiting_for_parts', 'equipment_failure', 'technical_complexity', 'external_dependency', 'other', null]
    },
    bottleneck_description: String,
    daily_time_entry_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DailyTimeEntry'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('JobReport', jobReportSchema);