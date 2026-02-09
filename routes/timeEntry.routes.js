const express = require('express');
const router = express.Router();
const DailyTimeEntry = require('../models/DailyTimeEntry');
const Job = require('../models/Job');
const JobReport = require('../models/JobReport');
const { requireAuth } = require('../middleware/auth');

// Get all time entries
router.get('/', requireAuth, async (req, res) => {
    try {
        const entries = await DailyTimeEntry.find().sort({ date: -1 }).limit(500);
        res.json(entries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get time entries for a technician
router.get('/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const entries = await DailyTimeEntry.find({ 
            technician_id: req.params.technicianId 
        }).sort({ date: -1 }).limit(50);
        res.json(entries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create time entry with job report and update job
router.post('/', requireAuth, async (req, res) => {
    try {
        const { timeEntry, report } = req.body;
        
        const entry = new DailyTimeEntry(timeEntry);
        await entry.save();
        
        if (report && report.work_completed) {
            const jobReport = new JobReport({
                ...report,
                daily_time_entry_id: entry._id
            });
            await jobReport.save();
            
            if (report.has_bottleneck) {
                const job = await Job.findById(timeEntry.job_id);
                if (job) {
                    job.bottleneck_count = (job.bottleneck_count || 0) + 1;
                    await job.save();
                }
            }
        }
        
        const job = await Job.findById(timeEntry.job_id);
        if (job) {
            const newConsumed = (job.consumed_hours || 0) + timeEntry.productive_hours;
            const newRemaining = job.allocated_hours - newConsumed;
            const progress = (newConsumed / job.allocated_hours) * 100;
            
            let status = job.status;
            if (job.status !== 'completed') {
                if (newConsumed > job.allocated_hours) {
                    status = 'over_allocated';
                } else if (newRemaining <= 0) {
                    status = 'at_risk';
                } else if (job.bottleneck_count >= 2) {
                    status = 'at_risk';
                } else {
                    status = 'in_progress';
                }
            }
            
            job.consumed_hours = newConsumed;
            job.remaining_hours = Math.max(0, newRemaining);
            job.progress_percentage = Math.min(100, progress);
            job.status = status;
            
            await job.save();
        }
        
        res.status(201).json(entry);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete all time entries
router.delete('/all', requireAuth, async (req, res) => {
    try {
        const result = await DailyTimeEntry.deleteMany({});
        res.json({ message: 'All time entries deleted', count: result.deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;