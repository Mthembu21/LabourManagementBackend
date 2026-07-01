const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis', 'kathu'],
        default: 'component',
        index: true,
        required: true
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

    date: {
        type: Date,
        required: true,
        index: true
    },

    day_of_week: {
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        required: true
    },

    // Type of absence
    attendance_type: {
        type: String,
        enum: ['leave', 'sick'],
        required: true,
        index: true
    },

    // Fixed hours credited (determined by day_of_week)
    // Monday-Thursday: 8 hours
    // Friday: 7 hours
    hours_credited: {
        type: Number,
        required: true,
        min: 7,
        max: 8
    },

    // Always true for these records (full day absence)
    is_full_day: {
        type: Boolean,
        default: true
    },

    // Notes or reason
    notes: {
        type: String,
        default: ''
    },

    // Approval workflow
    status: {
        type: String,
        enum: ['pending', 'approved', 'declined'],
        default: 'pending',
        index: true
    },

    approved_by: {
        type: String,
        default: null
    },

    approved_at: {
        type: Date,
        default: null
    },

    approval_notes: {
        type: String,
        default: ''
    },

    // Audit fields
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
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
    timestamps: true
});

// Unique constraint: one attendance record per technician per date
attendanceRecordSchema.index(
    { supervisor_key: 1, technician_id: 1, date: 1 },
    { unique: true }
);

// Index for queries by date range
attendanceRecordSchema.index({ supervisor_key: 1, technician_id: 1, date: 1 });
attendanceRecordSchema.index({ date: 1, supervisor_key: 1 });
attendanceRecordSchema.index({ status: 1, attendance_type: 1 });

// Pre-save hook to set hours_credited and day_of_week
attendanceRecordSchema.pre('save', function(next) {
    const date = new Date(this.date);
    const dayIndex = date.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Set day_of_week
    this.day_of_week = dayNames[dayIndex];

    // Validate it's a weekday
    if (dayIndex === 0 || dayIndex === 6) {
        return next(new Error('Cannot create attendance record for weekend'));
    }

    // Set hours_credited based on day_of_week
    // Friday (dayIndex === 5) = 7 hours, all others = 8 hours
    this.hours_credited = dayIndex === 5 ? 7 : 8;

    next();
});

// Static method to check if date has an approved absence
attendanceRecordSchema.statics.isAbsenceDay = async function(supervisorKey, technicianId, date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const record = await this.findOne({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        date: { $gte: startOfDay, $lte: endOfDay },
        status: 'approved'
    });

    return !!record;
};

// Static method to get absence details for a date
attendanceRecordSchema.statics.getAbsenceDetails = async function(supervisorKey, technicianId, date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const record = await this.findOne({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        date: { $gte: startOfDay, $lte: endOfDay },
        status: 'approved'
    });

    if (!record) return null;

    return {
        type: record.attendance_type,
        hours: record.hours_credited,
        date: record.date,
        notes: record.notes
    };
};

// Static method to count absence days in a date range
attendanceRecordSchema.statics.countAbsenceDays = async function(supervisorKey, technicianId, startDate, endDate) {
    const records = await this.find({
        supervisor_key: supervisorKey,
        technician_id: technicianId,
        date: { $gte: startDate, $lte: endDate },
        status: 'approved'
    });

    return {
        total_days: records.length,
        leave_days: records.filter(r => r.attendance_type === 'leave').length,
        sick_days: records.filter(r => r.attendance_type === 'sick').length,
        total_hours: records.reduce((sum, r) => sum + (r.hours_credited || 0), 0)
    };
};

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
