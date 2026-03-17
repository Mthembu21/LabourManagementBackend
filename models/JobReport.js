const mongoose = require('mongoose');

const jobReportSchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis'],
        default: 'component',
        index: true
    },
    job_id: {
        type: String,
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
        default: ''
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
    bottleneck_time_lost_hours: {
        type: Number,
        min: 0,
        default: 0
    },
    daily_time_entry_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DailyTimeEntry'
    }
}, {
    timestamps: true
});

jobReportSchema.index({ supervisor_key: 1, date: -1 });

module.exports = mongoose.model('JobReport', jobReportSchema);