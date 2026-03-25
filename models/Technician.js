const mongoose = require('mongoose');

const technicianSchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis'],
        default: 'component',
        index: true
    },
    name: {
        type: String,
        required: true
    },
    employee_id: {
        type: String,
        required: true,
        unique: true
    },
    // ✅ Add employeeNumber for compatibility (alias to employee_id)
    employeeNumber: {
        type: String,
        required: true,
        unique: true
    },
    department: String,
    skill: String,
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    // ✅ Add isActive field for global filtering
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// ✅ Virtual for backward compatibility
technicianSchema.virtual('supervisorId').get(function() {
    return this.supervisor_key;
});

technicianSchema.virtual('supervisorId').set(function(value) {
    this.supervisor_key = value;
});

// ✅ Ensure virtuals are included in JSON
technicianSchema.set('toJSON', { virtuals: true });
technicianSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Technician', technicianSchema);