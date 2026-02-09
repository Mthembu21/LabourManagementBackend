const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const { requireAuth, requireSupervisor } = require('../middleware/auth');

// Get all jobs
router.get('/', requireAuth, async (req, res) => {
    try {
        const jobs = await Job.find().sort({ createdAt: -1 }).limit(200);
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get jobs for a technician
router.get('/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const jobs = await Job.find({ assigned_technician_id: req.params.technicianId });
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create job
router.post('/', requireSupervisor, async (req, res) => {
    try {
        const jobData = {
            ...req.body,
            remaining_hours: req.body.allocated_hours
        };
        const job = new Job(jobData);
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update job
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const job = await Job.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        res.json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete job
router.delete('/:id', requireSupervisor, async (req, res) => {
    try {
        await Job.findByIdAndDelete(req.params.id);
        res.json({ message: 'Job deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;