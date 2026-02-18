const express = require('express');
const router = express.Router();
const DailyTimeEntry = require('../models/DailyTimeEntry');
const Job = require('../models/Job');
const JobReport = require('../models/JobReport');
const { requireAuth } = require('../middleware/auth');

const getHoursForDate = (dateObj) => {
    const dayIndex = dateObj.getDay();
    if (dayIndex === 5) return { hr: 7, productive: 6 }; // Friday
    return { hr: 8, productive: 7 };
};

const getDayRange = (dateObj) => {
    const start = new Date(dateObj);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
};

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
        const productiveHours = Number(timeEntry?.productive_hours || 0);
        const hrHours = Number(timeEntry?.hr_hours || 0);
        const technicianId = timeEntry?.technician_id;
        const technicianName = timeEntry?.technician_name;
        const jobNumber = timeEntry?.job_id;
        const entryDate = timeEntry?.date ? new Date(timeEntry.date) : null;

        if (!jobNumber) {
            return res.status(400).json({ error: 'job_id (Job ID) is required' });
        }
        if (!technicianId) {
            return res.status(400).json({ error: 'technician_id is required' });
        }

        if (!entryDate || Number.isNaN(entryDate.getTime())) {
            return res.status(400).json({ error: 'date is required' });
        }

        if (productiveHours < 0 || hrHours < 0) {
            return res.status(400).json({ error: 'Hours must be non-negative' });
        }

        const jobForCheck = await Job.findOne({ job_number: jobNumber });
        if (jobForCheck) {
            const remaining = Number(jobForCheck.remaining_hours ?? ((jobForCheck.allocated_hours || 0) - (jobForCheck.consumed_hours || 0))) || 0;
            if (productiveHours > remaining) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }
        }

        const { start, end } = getDayRange(entryDate);
        const existing = await DailyTimeEntry.find({
            technician_id: technicianId,
            date: { $gte: start, $lt: end }
        });
        const totals = existing.reduce(
            (acc, e) => {
                acc.hr += Number(e.hr_hours || 0);
                acc.productive += Number(e.productive_hours || 0);
                return acc;
            },
            { hr: 0, productive: 0 }
        );

        const max = getHoursForDate(entryDate);
        if ((totals.hr + hrHours) > max.hr + 1e-9) {
            return res.status(400).json({ error: `Daily HR hours limit exceeded (${max.hr})` });
        }
        if ((totals.productive + productiveHours) > max.productive + 1e-9) {
            return res.status(400).json({ error: `Daily productive hours limit exceeded (${max.productive})` });
        }

        const entry = new DailyTimeEntry(timeEntry);
        await entry.save();
        
        if (report && report.work_completed) {
            const jobReport = new JobReport({
                ...report,
                daily_time_entry_id: entry._id
            });
            await jobReport.save();
            
            if (report.has_bottleneck) {
                const job = await Job.findOne({ job_number: jobNumber });
                if (job) {
                    job.bottleneck_count = (job.bottleneck_count || 0) + 1;
                    await job.save();
                }
            }
        }
        
        // Update job totals and technician-specific totals by Job ID (job_number)
        let job = await Job.findOneAndUpdate(
            { job_number: jobNumber, 'technicians.technician_id': technicianId },
            {
                $inc: {
                    consumed_hours: productiveHours,
                    'technicians.$.consumed_hours': productiveHours
                }
            },
            { new: true }
        );

        if (!job) {
            job = await Job.findOneAndUpdate(
                { job_number: jobNumber },
                {
                    $inc: { consumed_hours: productiveHours },
                    $push: {
                        technicians: {
                            technician_id: technicianId,
                            technician_name: technicianName || '',
                            confirmed_by_technician: true,
                            confirmed_date: new Date(),
                            consumed_hours: productiveHours
                        }
                    }
                },
                { new: true }
            );
        }

        if (job) {
            const newConsumed = job.consumed_hours || 0;
            const newRemaining = (job.allocated_hours || 0) - newConsumed;
            const progress = job.allocated_hours ? (newConsumed / job.allocated_hours) * 100 : 0;

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

            job = await Job.findByIdAndUpdate(
                job._id,
                {
                    remaining_hours: Math.max(0, newRemaining),
                    progress_percentage: Math.min(100, progress),
                    status
                },
                { new: true }
            );
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