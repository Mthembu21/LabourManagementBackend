const mongoose = require('mongoose');

const supervisorSchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        required: true,
        enum: ['component', 'rebuild', 'pdis'],
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    password_hash: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Supervisor', supervisorSchema);
