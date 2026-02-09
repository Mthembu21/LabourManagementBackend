const mongoose = require('mongoose');

const technicianSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    employee_id: {
        type: String,
        required: true,
        unique: true
    },
    department: String,
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Technician', technicianSchema);