const mongoose = require('mongoose');

const trainingLogSchema = new mongoose.Schema({
    supervisor_key: {
        type: String,
        enum: ['component', 'rebuild', 'pdis'],
        default: 'component',
        index: true
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
    
    // Training details
    training_title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    training_category: {
        type: String,
        enum: [
            'Technical Skill Development',
            'Safety & Compliance',
            'Leadership & Management',
            'Product Knowledge',
            'System Training',
            'Soft Skills',
            'Certification',
            'Other'
        ],
        default: 'Other'
    },
    
    // Training duration
    hours_spent: {
        type: Number,
        required: true,
        min: 0.5,
        max: 24
    },
    training_date: {
        type: Date,
        required: true,
        index: true
    },
    
    // Trainer info
    trainer_name: String,
    trainer_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    
    // Training location/mode
    location: {
        type: String,
        enum: ['On-site', 'Off-site', 'Online', 'Hybrid'],
        default: 'On-site'
    },
    
    // Outcome
    competency_achieved: {
        type: Boolean,
        default: null
    },
    assessment_score: {
        type: Number,
        default: null,
        min: 0,
        max: 100
    },
    
    // Notes and feedback
    notes: String,
    feedback: String,
    
    // Approval
    approval_status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    approved_by: String,
    approved_date: Date,
    
    // Status
    training_status: {
        type: String,
        enum: ['scheduled', 'completed', 'cancelled', 'postponed'],
        default: 'completed'
    },
    
    // Related to day entry
    day_entry_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DayEntry',
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
    timestamps: true,
    indexes: [
        { supervisor_key: 1, technician_id: 1, training_date: 1 },
        { technician_id: 1, training_date: 1 },
        { training_status: 1, supervisor_key: 1 },
        { approval_status: 1, training_status: 1 }
    ]
});

module.exports = mongoose.model('TrainingLog', trainingLogSchema);
