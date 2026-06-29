const mongoose = require('mongoose');

// Fixed non-productive time block
const nonProductiveBlockSchema = new mongoose.Schema({
    name: {
        type: String,
        enum: ['Meeting', 'Tea Break', 'Lunch', 'Housekeeping', 'Other'],
        required: true
    },
    duration_hours: {
        type: Number,
        required: true,
        min: 0.01,
        max: 4
    },
    description: String
}, { _id: false });

const workingDayScheduleConfigSchema = new mongoose.Schema({
    day_type: {
        type: String,
        enum: ['monday_thursday', 'friday'],
        required: true,
        unique: true,
        index: true
    },

    // Total contracted hours for this day type
    total_scheduled_hours: {
        type: Number,
        required: true,
        min: 0
    },

    // Fixed non-productive time blocks (auto-allocated)
    fixed_non_productive_blocks: {
        type: [nonProductiveBlockSchema],
        default: [
            { name: 'Meeting', duration_hours: 0.25 },
            { name: 'Tea Break', duration_hours: 0.25 },
            { name: 'Lunch', duration_hours: 0.5 },
            { name: 'Housekeeping', duration_hours: 0.5 }
        ]
    },

    // Calculated fields (updated via pre-save hook)
    total_fixed_hours: {
        type: Number,
        default: 1.5,
        min: 0
    },

    available_productive_hours: {
        type: Number,
        default: 7.5,
        min: 0
    },

    // Status
    is_active: {
        type: Boolean,
        default: true,
        index: true
    },

    // Effective date (for future schedule changes)
    effective_from: {
        type: Date,
        default: Date.now
    },

    // Notes about schedule
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
    timestamps: true
});

// Pre-save hook to calculate totals
workingDayScheduleConfigSchema.pre('save', function(next) {
    if (this.fixed_non_productive_blocks && this.fixed_non_productive_blocks.length > 0) {
        this.total_fixed_hours = this.fixed_non_productive_blocks.reduce(
            (sum, block) => sum + (block.duration_hours || 0),
            0
        );
    }

    this.available_productive_hours = Math.max(
        0,
        (this.total_scheduled_hours || 0) - (this.total_fixed_hours || 0)
    );

    next();
});

// Static method to get active schedule for day type
workingDayScheduleConfigSchema.statics.getActiveSchedule = async function(dayType) {
    if (!['monday_thursday', 'friday'].includes(dayType)) {
        throw new Error('Invalid day_type. Must be "monday_thursday" or "friday"');
    }

    const schedule = await this.findOne({
        day_type: dayType,
        is_active: true,
        effective_from: { $lte: new Date() }
    }).sort({ effective_from: -1 });

    return schedule;
};

// Static method to determine day type from date
workingDayScheduleConfigSchema.statics.getDayType = function(date) {
    const dayOfWeek = new Date(date).getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
        throw new Error('Cannot determine schedule for weekend');
    }

    // Friday = 5, all others (Mon-Thu) = 1-4
    return dayOfWeek === 5 ? 'friday' : 'monday_thursday';
};

// Static method to get available productive hours for a date
workingDayScheduleConfigSchema.statics.getAvailableProductiveHours = async function(date) {
    const dayType = this.getDayType(date);
    const schedule = await this.getActiveSchedule(dayType);
    return schedule ? schedule.available_productive_hours : (dayType === 'friday' ? 6 : 7.5);
};

module.exports = mongoose.model('WorkingDayScheduleConfig', workingDayScheduleConfigSchema);
