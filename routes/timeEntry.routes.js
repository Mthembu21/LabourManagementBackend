const express = require('express');
const router = express.Router();
const TimeLog = require('../models/TimeLog');
const Job = require('../models/Job');
const JobReport = require('../models/JobReport');
const { requireAuth, tenantQuery } = require('../middleware/auth');

const IDLE_JOB_ID = 'IDLE / NON-PRODUCTIVE';

const requireSelfOrSupervisor = (req, res, technicianId) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (user.type === 'supervisor') return null;
    if (user.type === 'technician' && String(user.id) === String(technicianId)) return null;
    return res.status(403).json({ error: 'Not allowed' });
};

const isJobFullyCompleteByAssignments = (jobDoc) => {
    if (!jobDoc) return false;
    const subtasks = jobDoc.subtasks || [];
    if (!subtasks.length) return false;

    // Consider a subtask "required" only if it has explicit technician assignments.
    const requiredSubtasks = subtasks.filter((st) => Array.isArray(st?.assigned_technicians) && st.assigned_technicians.length > 0);
    if (!requiredSubtasks.length) return false;

    for (const st of requiredSubtasks) {
        for (const a of (st.assigned_technicians || [])) {
            const techId = a?.technician_id;
            if (!techId) return false;
            const p = (st.progress_by_technician || []).find((x) => String(x?.technician_id) === String(techId));
            const pct = Number(p?.progress_percentage || 0);
            if (pct < 100 - 1e-9) return false;
        }
    }
    return true;
};

const upsertSubtaskProgressForTechnician = (jobDoc, subtaskId, technicianId, progressPct) => {
    if (!jobDoc || !subtaskId || !technicianId) return;
    const st = (jobDoc.subtasks || []).id(subtaskId);
    if (!st) return;

    st.progress_by_technician = Array.isArray(st.progress_by_technician) ? st.progress_by_technician : [];
    const existing = st.progress_by_technician.find((p) => String(p?.technician_id) === String(technicianId));
    const pct = Math.max(0, Math.min(100, Number(progressPct || 0)));
    if (existing) {
        existing.progress_percentage = pct;
        existing.updated_at = new Date();
    } else {
        st.progress_by_technician.push({ technician_id: technicianId, progress_percentage: pct, updated_at: new Date() });
    }
};

const getSubtaskAllocationForTechnician = (jobDoc, subtaskId, technicianId) => {
    const job = jobDoc?.toObject ? jobDoc.toObject() : jobDoc;
    const subtasks = job?.subtasks || [];
    const st = subtasks.find((s) => s && s._id && s._id.toString() === String(subtaskId));
    if (!st) return null;
    const assigned = st.assigned_technicians || [];
    const a = assigned.find((x) => x.technician_id && x.technician_id.toString() === String(technicianId));
    if (!a) return null;
    const alloc = Number(a.allocated_hours || 0);
    return {
        subtask_title: st.title || null,
        allocated_hours: Number.isFinite(alloc) ? Math.max(0, alloc) : 0
    };
};

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
    if (dayIndex === 0 || dayIndex === 6) return 0; // Weekend => all overtime
    if (dayIndex === 5) return 7; // Friday
    return 8; // Mon-Thu (and weekend fallback)
};

const normalizeDayOnly = (d) => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
};

const computeJobStatus = (jobDoc) => {
    if (!jobDoc) return 'in_progress';
    if (jobDoc.status === 'completed') return 'completed';

    const allocated = Number(jobDoc.allocated_hours || 0);
    const consumed = Number(jobDoc.consumed_hours || 0);
    if (allocated > 0 && consumed > allocated) return 'overrun';

    const today = normalizeDayOnly(new Date());
    const target = jobDoc.target_completion_date ? normalizeDayOnly(jobDoc.target_completion_date) : null;
    if (target && today > target) return 'at_risk';
    if (Number(jobDoc.bottleneck_count || 0) >= 2) return 'at_risk';

    if (target && today <= target) {
        const remainingHours = Math.max(0, allocated - consumed);
        let workdaysRemaining = 0;
        const cursor = new Date(today);
        while (cursor <= target) {
            const day = cursor.getDay();
            if (day !== 0 && day !== 6) workdaysRemaining += 1;
            cursor.setDate(cursor.getDate() + 1);
        }

        const techIds = new Set();
        for (const t of (jobDoc.technicians || [])) {
            if (t?.technician_id) techIds.add(t.technician_id.toString());
        }
        for (const st of (jobDoc.subtasks || [])) {
            for (const a of (st?.assigned_technicians || [])) {
                if (a?.technician_id) techIds.add(a.technician_id.toString());
            }
        }
        const assignedCount = techIds.size || 1;
        const capacity = workdaysRemaining * 8 * assignedCount;
        if (remainingHours > capacity + 1e-9) return 'at_risk';
    }

    return 'in_progress';
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

        const query = { ...tenantQuery(req.tenant.supervisor_key) };
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

        if (req.session.user?.type === 'technician') {
            query.technician_id = req.session.user.id;
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
        const deny = requireSelfOrSupervisor(req, res, req.params.technicianId);
        if (deny) return;
        const entries = await TimeLog.find({
            ...tenantQuery(req.tenant.supervisor_key),
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
        const subtaskId = payload?.subtask_id ?? null;
        const entryDate = payload?.log_date ? new Date(payload.log_date) : (payload?.date ? new Date(payload.date) : null);

        if (req.session.user?.type === 'technician' && String(req.session.user.id) !== String(technicianId)) {
            return res.status(403).json({ error: 'Not allowed' });
        }

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
        const categoryDetail = typeof payload?.category_detail === 'string' ? payload.category_detail : '';

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

            if (category === 'Other' && !String(categoryDetail || '').trim()) {
                return res.status(400).json({ error: 'category_detail is required when category is Other' });
            }
        }

        // Normalize date to day boundary
        const logDate = TimeLog.normalizeLogDate(entryDate);
        const { start, end } = getDayRange(logDate);

        const existingDayLogs = await TimeLog.find({
            ...tenantQuery(req.tenant.supervisor_key),
            technician_id: technicianId,
            log_date: { $gte: start, $lt: end }
        });

        const totalForDay = existingDayLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
        if ((totalForDay + hoursLogged) > 24 + 1e-9) {
            return res.status(400).json({ error: 'Cannot log more than 24 hours in a day' });
        }

        // If a log already exists for the same technician + job + subtask + day, merge into it
        const existingSameJob = existingDayLogs.find((e) => String(e.job_id) === String(jobId) && String(e.subtask_id || '') === String(subtaskId || ''));
        const prevHoursForSameJob = existingSameJob ? Number(existingSameJob.hours_logged || 0) : 0;
        const deltaHours = hoursLogged;

        let resolvedSubtaskTitle = null;
        let jobForCheck = null;

        // Prevent logging to real jobs if job has no remaining hours, enforce stage allocation,
        // and block logging past target completion date.
        if (!isIdle) {
            if (!subtaskId) {
                return res.status(400).json({ error: 'subtask_id is required for job logs' });
            }

            jobForCheck = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                job_number: jobId
            });
            if (!jobForCheck) {
                return res.status(400).json({ error: 'Job not found' });
            }

            if (jobForCheck.target_completion_date) {
                const target = normalizeDayOnly(jobForCheck.target_completion_date);
                const logDay = normalizeDayOnly(logDate);
                // Allow logging past target date; job will be considered at-risk.
            }

            const remaining = Math.max(0, (Number(jobForCheck.allocated_hours || 0) - Number(jobForCheck.consumed_hours || 0)));
            if (deltaHours > remaining) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }

            const allocation = getSubtaskAllocationForTechnician(jobForCheck, subtaskId, technicianId);
            if (!allocation) {
                return res.status(400).json({ error: 'Technician is not assigned to this job stage' });
            }
            resolvedSubtaskTitle = allocation.subtask_title;

            const existingStageLogs = await TimeLog.find({
                ...tenantQuery(req.tenant.supervisor_key),
                technician_id: technicianId,
                job_id: jobId,
                subtask_id: String(subtaskId),
                is_idle: false
            });
            const alreadyLogged = existingStageLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
            if ((alreadyLogged + hoursLogged) > (allocation.allocated_hours + 1e-9)) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job stage' });
            }
        }

        let entry;
        if (existingSameJob) {
            existingSameJob.hours_logged = prevHoursForSameJob + hoursLogged;
            existingSameJob.is_idle = isIdle;
            existingSameJob.category = isIdle ? category : null;
            existingSameJob.category_detail = isIdle ? String(categoryDetail || '') : '';
            existingSameJob.subtask_id = isIdle ? null : String(subtaskId);
            existingSameJob.subtask_title = isIdle ? null : resolvedSubtaskTitle;
            entry = await existingSameJob.save();
        } else {
            entry = new TimeLog({
                supervisor_key: req.tenant.supervisor_key,
                technician_id: technicianId,
                job_id: jobId,
                subtask_id: isIdle ? null : String(subtaskId),
                subtask_title: isIdle ? null : resolvedSubtaskTitle,
                hours_logged: hoursLogged,
                log_date: logDate,
                category: isIdle ? category : null,
                category_detail: isIdle ? String(categoryDetail || '') : '',
                is_idle: isIdle,
                normal_hours: 0,
                overtime_hours: 0
            });
            await entry.save();
        }

        await reallocateDayNormalOvertime(technicianId, logDate);
        
        if (report && report.work_completed) {
            const jobReport = new JobReport({
                supervisor_key: req.tenant.supervisor_key,
                ...report,
                daily_time_entry_id: entry._id
            });
            await jobReport.save();
            
            if (report.has_bottleneck) {
                const job = await Job.findOne({
                    ...tenantQuery(req.tenant.supervisor_key),
                    job_number: jobId
                });
                if (job) {
                    job.bottleneck_count = (job.bottleneck_count || 0) + 1;
                    const allocated = Number(job.allocated_hours || 0);
                    const consumed = Number(job.consumed_hours || 0);
                    if (allocated > 0 && consumed > allocated) {
                        job.status = 'overrun';
                    } else if ((job.bottleneck_count || 0) >= 2 && job.status !== 'completed') {
                        job.status = 'at_risk';
                    }
                    await job.save();
                }
            }
        }
        
        if (!isIdle) {
            const job = jobForCheck || await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: jobId });
            if (job) {
                job.consumed_hours = Number(job.consumed_hours || 0) + deltaHours;
                const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
                if (tech) {
                    tech.consumed_hours = Number(tech.consumed_hours || 0) + deltaHours;
                }

                // Auto-update subtask progress for this technician based on allocated stage hours
                // (so progress is not stuck at zero unless manually edited)
                if (subtaskId) {
                    const allocation = getSubtaskAllocationForTechnician(job, subtaskId, technicianId);
                    const allocHours = Number(allocation?.allocated_hours || 0);
                    if (allocHours > 0) {
                        const newStageHours = alreadyLogged + hoursLogged;
                        const pct = (newStageHours / allocHours) * 100;
                        upsertSubtaskProgressForTechnician(job, subtaskId, technicianId, pct);
                    }
                }

                const newConsumed = Number(job.consumed_hours || 0);
                const allocated = Number(job.allocated_hours || 0);
                const overrunHours = Math.max(0, newConsumed - allocated);
                const progress = allocated > 0 ? (newConsumed / allocated) * 100 : 0;
                const remaining = Math.max(0, allocated - newConsumed);

                job.remaining_hours = remaining;
                job.overrun_hours = overrunHours;
                job.progress_percentage = Math.min(100, progress);
                job.status = computeJobStatus(job);

                // Auto-complete when all assigned stages are complete
                if (job.status !== 'completed' && isJobFullyCompleteByAssignments(job)) {
                    job.status = 'completed';
                    job.progress_percentage = 100;
                    job.remaining_hours = 0;
                    job.actual_completion_date = new Date();
                    job.total_hours_utilized = Number(job.consumed_hours || 0);
                }

                await job.save();
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
        if (req.session.user?.type !== 'supervisor') {
            return res.status(403).json({ error: 'Supervisor access required' });
        }
        const result = await TimeLog.deleteMany(tenantQuery(req.tenant.supervisor_key));
        res.json({ message: 'All time entries deleted', count: result.deletedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a single time log
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const entry = await TimeLog.findOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        if (!entry) return res.status(404).json({ error: 'Time log not found' });
        const deny = requireSelfOrSupervisor(req, res, entry.technician_id);
        if (deny) return;
        res.json(entry);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update a time log (edit instead of creating duplicate)
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const existing = await TimeLog.findOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        if (!existing) return res.status(404).json({ error: 'Time log not found' });
        const deny = requireSelfOrSupervisor(req, res, existing.technician_id);
        if (deny) return;
        const payload = req.body?.timeLog || req.body || {};

        const newHours = Number(payload?.hours_logged);
        const newCategory = payload?.category ?? null;
        const isIdle = typeof payload?.is_idle !== 'undefined' ? !!payload.is_idle : !!existing.is_idle;
        const subtaskId = payload?.subtask_id ?? existing.subtask_id ?? null;

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

        // For job logs: enforce stage assignment, stage cap, job cap, and target completion date
        if (!isIdle) {
            if (!subtaskId) return res.status(400).json({ error: 'subtask_id is required for job logs' });

            const jobForCheck = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                job_number: existing.job_id
            });
            if (!jobForCheck) return res.status(400).json({ error: 'Job not found' });

            if (jobForCheck.target_completion_date) {
                const target = normalizeDayOnly(jobForCheck.target_completion_date);
                const logDay = normalizeDayOnly(logDate);
                if (logDay > target) {
                    return res.status(400).json({ error: 'Cannot log hours past job target completion date' });
                }
            }

            const allocation = getSubtaskAllocationForTechnician(jobForCheck, subtaskId, existing.technician_id);
            if (!allocation) {
                return res.status(400).json({ error: 'Technician is not assigned to this job stage' });
            }

            const otherStageLogs = await TimeLog.find({
                ...tenantQuery(req.tenant.supervisor_key),
                technician_id: existing.technician_id,
                job_id: existing.job_id,
                subtask_id: String(subtaskId),
                is_idle: false,
                _id: { $ne: existing._id }
            });
            const alreadyLoggedStage = otherStageLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
            if ((alreadyLoggedStage + newHours) > (allocation.allocated_hours + 1e-9)) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job stage' });
            }

            const remainingJob = Math.max(0, (Number(jobForCheck.allocated_hours || 0) - Number(jobForCheck.consumed_hours || 0)));
            const delta = newHours - Number(existing.hours_logged || 0);
            if (delta > remainingJob) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }
        }

        const normalLimit = getNormalLimitForDate(logDate);
        const normalUsed = otherDayLogs.reduce((sum, e) => sum + Number(e.normal_hours || 0), 0);
        const normalRemaining = Math.max(0, normalLimit - normalUsed);
        const normalHours = Math.min(newHours, normalRemaining);
        const overtimeHours = Math.max(0, newHours - normalHours);

        const prevHours = Number(existing.hours_logged || 0);
        existing.hours_logged = newHours;
        existing.is_idle = isIdle;
        existing.category = isIdle ? newCategory : null;
        existing.subtask_id = isIdle ? null : String(subtaskId);
        existing.normal_hours = normalHours;
        existing.overtime_hours = overtimeHours;
        await existing.save();

        await reallocateDayNormalOvertime(existing.technician_id, logDate);

        if (!existing.is_idle) {
            const delta = newHours - prevHours;
            const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: existing.job_id });
            if (job) {
                job.consumed_hours = Number(job.consumed_hours || 0) + delta;
                const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(existing.technician_id));
                if (tech) {
                    tech.consumed_hours = Number(tech.consumed_hours || 0) + delta;
                }

                const newConsumed = Number(job.consumed_hours || 0);
                const allocated = Number(job.allocated_hours || 0);
                const remaining = Math.max(0, allocated - newConsumed);
                const overrunHours = Math.max(0, newConsumed - allocated);
                const progress = allocated > 0 ? (newConsumed / allocated) * 100 : 0;

                job.remaining_hours = remaining;
                job.overrun_hours = overrunHours;
                job.progress_percentage = Math.min(100, progress);
                job.status = computeJobStatus(job);
                await job.save();
            }
        }

        res.json(existing);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete a time log
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const existing = await TimeLog.findOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        if (!existing) return res.status(404).json({ error: 'Time log not found' });
        const deny = requireSelfOrSupervisor(req, res, existing.technician_id);
        if (deny) return;

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