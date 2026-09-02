const mongoose = require('mongoose');

const technicianSchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis', 'kathu'],
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
    },
    // Set when a supervisor permanently moves this technician in from another
    // component. Distinct from TemporaryAssignment: this changes supervisor_key
    // itself, so future utilization attributes to the new home workshop.
    previous_supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis', 'kathu'],
        default: null
    },
    transferred_at: Date,
    transferred_by: String,
    transfer_history: [{
        from_supervisor_key: String,
        to_supervisor_key: String,
        reason: String,
        transferred_at: Date,
        transferred_by: String
    }]
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