const mongoose = require('mongoose');

const monthlyArchiveSchema = new mongoose.Schema({
    month_year: {
        type: String,
        required: true
    },
    start_date: {
        type: Date,
        required: true
    },
    end_date: {
        type: Date,
        required: true
    },
    working_days: {
        type: Number,
        required: true
    },
    total_hr_hours: Number,
    total_productive_hours: Number,
    total_weighted_overtime: Number,
    technicians_summary: [{
        technician_id: String,
        technician_name: String,
        hr_hours: Number,
        productive_hours: Number,
        weighted_overtime: Number
    }],
    archived_date: Date
}, {
    timestamps: true
});

module.exports = mongoose.model('MonthlyArchive', monthlyArchiveSchema);