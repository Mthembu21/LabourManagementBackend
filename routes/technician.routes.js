const express = require('express');
const router = express.Router();
const Technician = require('../models/Technician');
const DailyTimeEntry = require('../models/DailyTimeEntry');
const TimeLog = require('../models/TimeLog');
const JobReport = require('../models/JobReport');
const TemporaryAssignment = require('../models/TemporaryAssignment');
const { requireAuth, requireSupervisor, tenantQuery } = require('../middleware/auth');

// Get all technicians
router.get('/', requireAuth, async (req, res) => {
    try {
        const technicians = await Technician.find(tenantQuery(req.tenant.supervisor_key)).sort({ createdAt: -1 });
        res.json(technicians);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create technician
router.post('/', requireSupervisor, async (req, res) => {
    try {
        // ✅ Prevent duplicate technicians by employee number
        const existing = await Technician.findOne({
            employee_id: req.body.employee_id || req.body.employeeNumber
        });
        
        if (existing) {
            return res.status(400).json({
                message: "Technician already exists. Please search and assign instead."
            });
        }

        const technician = new Technician({
            ...req.body,
            supervisor_key: req.tenant.supervisor_key,
            // ✅ Ensure both fields are set for compatibility
            employeeNumber: req.body.employeeNumber || req.body.employee_id,
            employee_id: req.body.employee_id || req.body.employeeNumber
        });
        await technician.save();
        res.status(201).json(technician);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ✅ GET all technicians (global search)
router.get('/all', requireAuth, async (req, res) => {
    try {
        const technicians = await Technician.find({ isActive: true });
        console.log('Total technicians in database:', technicians.length);
        res.json(technicians);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ✅ Optional (Better UX – search)
router.get('/search', requireAuth, async (req, res) => {
    const { q } = req.query;

    try {
        const searchRegex = { $regex: q || '', $options: 'i' };
        
        const technicians = await Technician.find({
            $or: [
                { name: searchRegex },
                { employee_id: searchRegex },
                { employeeNumber: searchRegex }
            ],
            $or: [
                { isActive: true },
                { isActive: { $exists: false } } // Include technicians without isActive field
            ]
        });
        
        // Add supervisor information to search results
        const enrichedTechnicians = technicians.map(tech => ({
            ...tech.toObject(),
            isTemporary: tech.supervisor_key !== req.tenant.supervisor_key,
            originalSupervisor: tech.supervisor_key,
            canAssign: true // All technicians can be temporarily assigned
        }));
        
        res.json(enrichedTechnicians);
    } catch (err) {
        console.error('Backend search error:', err);
        res.status(500).json({ message: err.message });
    }
});

// ✅ Temporary assignment endpoint
router.post('/temporary-assignment', requireSupervisor, async (req, res) => {
    try {
        const { technician_id, duration_hours, reason } = req.body;
        
        if (!technician_id) {
            return res.status(400).json({ error: 'technician_id is required' });
        }
        
        if (!reason || reason.trim() === '') {
            console.log('Reason validation failed:', { reason, trimmed: reason?.trim(), isEmpty: !reason || reason.trim() === '' });
            return res.status(400).json({ error: 'reason is required for temporary assignment' });
        }
        
        // Find technician
        const technician = await Technician.findById(technician_id);
        if (!technician) {
            return res.status(404).json({ error: 'Technician not found' });
        }
        
        // Check if technician already has an active temporary assignment
        const existingAssignment = await TemporaryAssignment.findOne({
            technician_id,
            status: 'active',
            expires_at: { $gt: new Date() }
        });
        
        if (existingAssignment) {
            return res.status(400).json({ 
                error: 'Technician already has an active temporary assignment',
                existingAssignment 
            });
        }
        
        // Create temporary assignment record in database
        console.log('Creating temporary assignment with data:', {
            technician_id,
            original_supervisor_key: technician.supervisor_key,
            temporary_supervisor_key: req.tenant.supervisor_key,
            duration_hours: duration_hours || 8,
            reason: reason.trim()
        });
        
        const temporaryAssignment = new TemporaryAssignment({
            technician_id,
            original_supervisor_key: technician.supervisor_key,
            temporary_supervisor_key: req.tenant.supervisor_key,
            duration_hours: duration_hours || 8,
            reason: reason.trim(),
            assigned_at: new Date(),
            expires_at: new Date(Date.now() + ((duration_hours || 8) * 60 * 60 * 1000))
        });
        
        const savedAssignment = await temporaryAssignment.save();
        console.log('Saved temporary assignment:', savedAssignment);
        
        // Populate technician details for response
        await temporaryAssignment.populate('technician_id', 'name employee_id employeeNumber department');
        
        res.json({
            message: 'Technician temporarily assigned successfully',
            assignment: temporaryAssignment,
            technician: {
                ...technician.toObject(),
                isTemporary: true,
                originalSupervisor: technician.supervisor_key,
                temporaryAssignment: {
                    id: temporaryAssignment._id,
                    expires_at: temporaryAssignment.expires_at,
                    duration_hours: temporaryAssignment.duration_hours,
                    reason: temporaryAssignment.reason
                }
            }
        });
    } catch (error) {
        console.error('Temporary assignment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get active temporary assignments for current supervisor
router.get('/temporary-assignments', requireSupervisor, async (req, res) => {
    try {
        const assignments = await TemporaryAssignment.find({
            temporary_supervisor_key: req.tenant.supervisor_key,
            status: 'active',
            expires_at: { $gt: new Date() }
        }).populate('technician_id', 'name employee_id employeeNumber department')
        .sort({ assigned_at: -1 });
        
        res.json(assignments);
    } catch (error) {
        console.error('Get temporary assignments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Complete temporary assignment
router.put('/temporary-assignment/:id/complete', requireSupervisor, async (req, res) => {
    try {
        const { performance_note } = req.body;
        
        const assignment = await TemporaryAssignment.findOne({
            _id: req.params.id,
            temporary_supervisor_key: req.tenant.supervisor_key,
            status: 'active'
        });
        
        if (!assignment) {
            return res.status(404).json({ error: 'Temporary assignment not found' });
        }
        
        assignment.status = 'completed';
        if (performance_note) {
            assignment.performance_notes.push({
                date: new Date(),
                note: performance_note,
                hours_contributed: assignment.total_hours_logged
            });
        }
        
        await assignment.save();
        
        res.json({
            message: 'Temporary assignment completed successfully',
            assignment
        });
    } catch (error) {
        console.error('Complete temporary assignment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update technician
router.put('/:id', requireSupervisor, async (req, res) => {
    try {
        const tech = await Technician.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            _id: req.params.id
        });
        if (!tech) return res.status(404).json({ error: 'Technician not found' });

        const body = req.body || {};

        if (typeof body.name === 'string') tech.name = body.name;
        if (typeof body.employee_id === 'string') tech.employee_id = body.employee_id;
        if (typeof body.department === 'string') tech.department = body.department;
        if (typeof body.status === 'string') tech.status = body.status;

        await tech.save();
        res.json(tech);
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ error: 'employee_id already exists' });
        }
        res.status(400).json({ error: error.message });
    }
});

// Delete technician (and their time entries)
router.delete('/:id', requireSupervisor, async (req, res) => {
    try {
        const filter = { ...tenantQuery(req.tenant.supervisor_key), technician_id: req.params.id };
        await DailyTimeEntry.deleteMany(filter);
        await TimeLog.deleteMany(filter);
        await JobReport.deleteMany(filter);
        await Technician.deleteOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        res.json({ message: 'Technician and time entries deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;