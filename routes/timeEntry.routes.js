const express = require('express');
const router = express.Router();
const TimeLog = require('../models/TimeLog');
const Job = require('../models/Job');
const JobReport = require('../models/JobReport');
const { requireAuth } = require('../middleware/auth');

const IDLE_JOB_ID = 'IDLE / NON-PRODUCTIVE';

router.get('/idle-categories', requireAuth, async (req, res) => {
    try {
        res.json({
            job_id: IDLE_JOB_ID,
            categories: TimeLog.IDLE_CATEGORIES || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const getNormalLimitForDate = (dateObj) => {
    const dayIndex = dateObj.getDay();
    if (dayIndex === 5) return 7; // Friday
    return 8; // Mon-Thu (and weekend fallback)
};

const getDayRange = (dateObj) => {
    const start = new Date(dateObj);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
};

const reallocateDayNormalOvertime = async (technicianId, logDate) => {
    const day = TimeLog.normalizeLogDate(logDate);
    const { start, end } = getDayRange(day);
    const logs = await TimeLog.find({
        technician_id: technicianId,
        log_date: { $gte: start, $lt: end }
    }).sort({ createdAt: 1, _id: 1 });

    const normalLimit = getNormalLimitForDate(day);
    let normalRemaining = normalLimit;

    for (const l of logs) {
        const hrs = Number(l.hours_logged || 0);
        const normal = Math.max(0, Math.min(hrs, normalRemaining));
        const ot = Math.max(0, hrs - normal);
        normalRemaining = Math.max(0, normalRemaining - normal);

        if (Number(l.normal_hours || 0) !== normal || Number(l.overtime_hours || 0) !== ot) {
            l.normal_hours = normal;
            l.overtime_hours = ot;
            await l.save();
        }
    }
};

const recalcJobProgress = async (jobId) => {
    const job = await Job.findOne({ job_number: jobId });
    if (!job) return null;
    const newConsumed = Number(job.consumed_hours || 0);
    const allocated = Number(job.allocated_hours || 0);
    const overrunHours = Math.max(0, newConsumed - allocated);
    const progress = allocated > 0 ? (newConsumed / allocated) * 100 : 0;
    const remaining = Math.max(0, allocated - newConsumed);

    let status = job.status;
    if (job.status !== 'completed') {
        if (newConsumed > allocated) {
            status = 'overrun';
        } else {
            status = 'in_progress';
        }
    }

    return Job.findByIdAndUpdate(
        job._id,
        {
            remaining_hours: remaining,
            progress_percentage: Math.min(100, progress),
            overrun_hours: overrunHours,
            status
        },
        { new: true }
    );
};

// Get all time logs (supports filtering)
router.get('/', requireAuth, async (req, res) => {
    try {
        const { technician_id, category, start_date, end_date, is_idle } = req.query;

        const query = {};
        if (technician_id) query.technician_id = technician_id;
        if (typeof is_idle !== 'undefined') query.is_idle = String(is_idle) === 'true';
        if (category) query.category = category;

        if (start_date || end_date) {
            const start = start_date ? new Date(start_date) : null;
            const end = end_date ? new Date(end_date) : null;
            query.log_date = {};
            if (start && !Number.isNaN(start.getTime())) {
                start.setHours(0, 0, 0, 0);
                query.log_date.$gte = start;
            }
            if (end && !Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                query.log_date.$lte = end;
            }
            if (!Object.keys(query.log_date).length) delete query.log_date;
        }

        const entries = await TimeLog.find(query).sort({ log_date: -1, createdAt: -1 }).limit(500);
        res.json(entries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get time entries for a technician
router.get('/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const entries = await TimeLog.find({
            technician_id: req.params.technicianId
        }).sort({ log_date: -1, createdAt: -1 }).limit(100);
        res.json(entries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create time log with optional job report and update job
router.post('/', requireAuth, async (req, res) => {
    try {
        const { timeLog, report, timeEntry } = req.body;

        // Backward compatibility: accept old `timeEntry` payload
        const payload = timeLog || timeEntry || {};

        const technicianId = payload?.technician_id;
        const jobId = payload?.job_id;
        const entryDate = payload?.log_date ? new Date(payload.log_date) : (payload?.date ? new Date(payload.date) : null);

        // Old payload may send productive_hours; new payload should send hours_logged
        const hoursLogged = Number(
            typeof payload?.hours_logged !== 'undefined'
                ? payload.hours_logged
                : (payload?.productive_hours || 0)
        );

        const isIdle = typeof payload?.is_idle !== 'undefined'
            ? !!payload.is_idle
            : (jobId === IDLE_JOB_ID);
        const category = payload?.category ?? null;

        if (!technicianId) return res.status(400).json({ error: 'technician_id is required' });
        if (!jobId) return res.status(400).json({ error: 'job_id is required' });
        if (!entryDate || Number.isNaN(entryDate.getTime())) return res.status(400).json({ error: 'log_date is required' });
        if (hoursLogged <= 0) return res.status(400).json({ error: 'hours_logged must be > 0' });

        if (isIdle) {
            if (jobId !== IDLE_JOB_ID) {
                return res.status(400).json({ error: `Idle logs must use job_id '${IDLE_JOB_ID}'` });
            }
            if (!category) {
                return res.status(400).json({ error: 'category is required for idle logs' });
            }
            const allowed = TimeLog.IDLE_CATEGORIES || [];
            if (!allowed.includes(category)) {
                return res.status(400).json({ error: 'Invalid category' });
            }
        }

        // Normalize date to day boundary
        const logDate = TimeLog.normalizeLogDate(entryDate);
        const { start, end } = getDayRange(logDate);

        const existingDayLogs = await TimeLog.find({
            technician_id: technicianId,
            log_date: { $gte: start, $lt: end }
        });

        const totalForDay = existingDayLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
        if ((totalForDay + hoursLogged) > 24 + 1e-9) {
            return res.status(400).json({ error: 'Cannot log more than 24 hours in a day' });
        }

        // If a log already exists for the same technician + job + day, merge into it
        const existingSameJob = existingDayLogs.find((e) => String(e.job_id) === String(jobId));
        const prevHoursForSameJob = existingSameJob ? Number(existingSameJob.hours_logged || 0) : 0;
        const deltaHours = hoursLogged;

        // Prevent logging to real jobs if job has no remaining hours (check delta only)
        if (!isIdle) {
            const jobForCheck = await Job.findOne({ job_number: jobId });
            if (!jobForCheck) {
                return res.status(400).json({ error: 'Job not found' });
            }
            const remaining = Math.max(0, (Number(jobForCheck.allocated_hours || 0) - Number(jobForCheck.consumed_hours || 0)));
            if (deltaHours > remaining) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }
        }

        let entry;
        if (existingSameJob) {
            existingSameJob.hours_logged = prevHoursForSameJob + hoursLogged;
            existingSameJob.is_idle = isIdle;
            existingSameJob.category = isIdle ? category : null;
            entry = await existingSameJob.save();
        } else {
            entry = new TimeLog({
                technician_id: technicianId,
                job_id: jobId,
                hours_logged: hoursLogged,
                log_date: logDate,
                category: isIdle ? category : null,
                is_idle: isIdle,
                normal_hours: 0,
                overtime_hours: 0
            });
            await entry.save();
        }

        await reallocateDayNormalOvertime(technicianId, logDate);
        
        if (report && report.work_completed) {
            const jobReport = new JobReport({
                ...report,
                daily_time_entry_id: entry._id
            });
            await jobReport.save();
            
            if (report.has_bottleneck) {
                const job = await Job.findOne({ job_number: jobId });
                if (job) {
                    job.bottleneck_count = (job.bottleneck_count || 0) + 1;
                    await job.save();
                }
            }
        }
        
        if (!isIdle) {
            // Update job totals and technician-specific totals by Job ID (job_number)
            let job = await Job.findOneAndUpdate(
                { job_number: jobId, 'technicians.technician_id': technicianId },
                {
                    $inc: {
                        consumed_hours: deltaHours,
                        'technicians.$.consumed_hours': deltaHours
                    }
                },
                { new: true }
            );

            if (job) {
                const newConsumed = Number(job.consumed_hours || 0);
                const allocated = Number(job.allocated_hours || 0);
                const overrunHours = Math.max(0, newConsumed - allocated);
                const progress = allocated > 0 ? (newConsumed / allocated) * 100 : 0;
                const remaining = Math.max(0, allocated - newConsumed);

                let status = job.status;
                if (job.status !== 'completed') {
                    if (newConsumed > allocated) {
                        status = 'overrun';
                    } else {
                        status = 'in_progress';
                    }
                }

                await Job.findByIdAndUpdate(
                    job._id,
                    {
                        remaining_hours: remaining,
                        progress_percentage: Math.min(100, progress),
                        overrun_hours: overrunHours,
                        status
                    },
                    { new: true }
                );
            }
        }
        
        res.status(201).json(entry);
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(400).json({ error: 'Duplicate log entry for same job and date' });
        }
        res.status(400).json({ error: error.message });
    }
});

// Delete all time entries
router.delete('/all', requireAuth, async (req, res) => {
    try {
        const result = await TimeLog.deleteMany({});
        res.json({ message: 'All time entries deleted', count: result.deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a single time log
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const entry = await TimeLog.findById(req.params.id);
        if (!entry) return res.status(404).json({ error: 'Time log not found' });
        res.json(entry);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update a time log (edit instead of creating duplicate)
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const existing = await TimeLog.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Time log not found' });

        const payload = req.body?.timeLog || req.body || {};

        const newHours = Number(payload?.hours_logged);
        const newCategory = payload?.category ?? null;
        const isIdle = typeof payload?.is_idle !== 'undefined' ? !!payload.is_idle : !!existing.is_idle;

        if (!newHours || newHours <= 0) return res.status(400).json({ error: 'hours_logged must be > 0' });
        if (isIdle && (!newCategory || !(TimeLog.IDLE_CATEGORIES || []).includes(newCategory))) {
            return res.status(400).json({ error: 'Valid category is required for idle logs' });
        }

        const logDate = TimeLog.normalizeLogDate(existing.log_date);
        const { start, end } = getDayRange(logDate);

        const otherDayLogs = await TimeLog.find({
            technician_id: existing.technician_id,
            log_date: { $gte: start, $lt: end },
            _id: { $ne: existing._id }
        });

        const totalOther = otherDayLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
        if ((totalOther + newHours) > 24 + 1e-9) {
            return res.status(400).json({ error: 'Cannot log more than 24 hours in a day' });
        }

        const normalLimit = getNormalLimitForDate(logDate);
        const normalUsed = otherDayLogs.reduce((sum, e) => sum + Number(e.normal_hours || 0), 0);
        const normalRemaining = Math.max(0, normalLimit - normalUsed);
        const normalHours = Math.min(newHours, normalRemaining);
        const overtimeHours = Math.max(0, newHours - normalHours);

        if (!isIdle) {
            const jobForCheck = await Job.findOne({ job_number: existing.job_id });
            if (!jobForCheck) return res.status(400).json({ error: 'Job not found' });

            const remaining = Math.max(0, (Number(jobForCheck.allocated_hours || 0) - Number(jobForCheck.consumed_hours || 0)));
            const delta = newHours - Number(existing.hours_logged || 0);
            if (delta > remaining) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }
        }

        const prevHours = Number(existing.hours_logged || 0);
        existing.hours_logged = newHours;
        existing.is_idle = isIdle;
        existing.category = isIdle ? newCategory : null;
        existing.normal_hours = normalHours;
        existing.overtime_hours = overtimeHours;
        await existing.save();

        if (!existing.is_idle) {
            const delta = newHours - prevHours;
            await Job.findOneAndUpdate(
                { job_number: existing.job_id, 'technicians.technician_id': existing.technician_id },
                {
                    $inc: {
                        consumed_hours: delta,
                        'technicians.$.consumed_hours': delta
                    }
                },
                { new: true }
            );
            await recalcJobProgress(existing.job_id);
        }

        res.json(existing);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete a time log
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const existing = await TimeLog.findById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Time log not found' });

        const hours = Number(existing.hours_logged || 0);
        const jobId = existing.job_id;
        const technicianId = existing.technician_id;
        const isIdle = !!existing.is_idle;

        await TimeLog.deleteOne({ _id: existing._id });

        if (!isIdle) {
            await Job.findOneAndUpdate(
                { job_number: jobId, 'technicians.technician_id': technicianId },
                {
                    $inc: {
                        consumed_hours: -hours,
                        'technicians.$.consumed_hours': -hours
                    }
                },
                { new: true }
            );
            await recalcJobProgress(jobId);
        }

        res.json({ message: 'Time log deleted' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;