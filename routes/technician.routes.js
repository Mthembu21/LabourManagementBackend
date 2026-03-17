const express = require('express');
const router = express.Router();
const Technician = require('../models/Technician');
const DailyTimeEntry = require('../models/DailyTimeEntry');
const TimeLog = require('../models/TimeLog');
const JobReport = require('../models/JobReport');
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
        const technician = new Technician({
            ...req.body,
            supervisor_key: req.tenant.supervisor_key
        });
        await technician.save();
        res.status(201).json(technician);
    } catch (error) {
        res.status(400).json({ error: error.message });
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