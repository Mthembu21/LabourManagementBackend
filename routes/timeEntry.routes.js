const express = require('express');
const router = express.Router();
const TimeLog = require('../models/TimeLog');
const MonthlyHoursSummary = require('../models/MonthlyHoursSummary');
const Job = require('../models/Job');
const JobReport = require('../models/JobReport');
const Technician = require('../models/Technician');
const { requireAuth, requireSupervisor, tenantQuery } = require('../middleware/auth');
const { getSouthAfricanHolidayInfo, normalizeDayOnly: normalizeHolidayDayOnly } = require('../lib/zaHolidays');

const IDLE_JOB_ID = 'IDLE / NON-PRODUCTIVE';

const requireForemanOrManager = (req, res) => {
    if (!req.session?.user || req.session.user.type !== 'supervisor') {
        return res.status(403).json({ error: 'Supervisor access required' });
    }
    const role = req.session.user.role || 'supervisor';
    if (!['foreman', 'manager'].includes(role)) {
        return res.status(403).json({ error: 'Foreman access required' });
    }
    return null;
};

const sumSubmittedJobHours = async ({ supervisorKey, jobId }) => {
    if (!jobId || jobId === IDLE_JOB_ID) return 0;
    const logs = await TimeLog.find({
        ...tenantQuery(supervisorKey),
        is_idle: false,
        job_id: String(jobId)
    });
    return logs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
};

const requiresApprovalForTenant = (supervisorKey) => {
    return supervisorKey === 'pdis' || supervisorKey === 'rebuild';
};

const requireSelfOrSupervisor = (req, res, technicianId) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    if (user.type === 'supervisor') return null;
    if (user.type === 'technician' && String(user.id) === String(technicianId)) return null;
    return res.status(403).json({ error: 'Not allowed' });
};

const sumApprovedStageHours = async ({ supervisorKey, jobId, subtaskId, technicianId }) => {
    if (!jobId || !subtaskId || !technicianId) return 0;
    const logs = await TimeLog.find({
        ...tenantQuery(supervisorKey),
        is_idle: false,
        job_id: String(jobId),
        subtask_id: String(subtaskId),
        technician_id: technicianId
    });
    return logs.reduce((sum, e) => sum + Number(e.approved_hours || 0), 0);
};

const updateJobForApprovedDelta = async ({ supervisorKey, jobId, subtaskId, technicianId, deltaApproved }) => {
    if (!deltaApproved || Math.abs(Number(deltaApproved || 0)) <= 1e-9) return;
    if (!jobId || jobId === IDLE_JOB_ID) return;

    const job = await Job.findOne({ ...tenantQuery(supervisorKey), job_number: String(jobId) });
    if (!job) return;

    job.consumed_hours = Math.max(0, Number(job.consumed_hours || 0) + Number(deltaApproved || 0));
    const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
    if (tech) {
        tech.consumed_hours = Math.max(0, Number(tech.consumed_hours || 0) + Number(deltaApproved || 0));
    }

    if (subtaskId) {
        const allocation = getSubtaskAllocationForTechnician(job, subtaskId, technicianId);
        const allocHours = Number(allocation?.allocated_hours || 0);
        // ✅ Allow progress tracking even if allocated_hours is 0
        if (allocHours > 0) {
            const stageSum = await sumApprovedStageHours({ supervisorKey, jobId, subtaskId, technicianId });
            upsertSubtaskProgressForTechnician(job, subtaskId, technicianId, (stageSum / allocHours) * 100);
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

    // Rule A: auto-complete when all assigned stages are complete (independent of remaining hours)
    if (job.status !== 'completed' && isJobFullyCompleteByAssignments(job)) {
        job.status = 'completed';
        job.progress_percentage = 100;
        job.remaining_hours = 0;
        job.actual_completion_date = new Date();
        job.total_hours_utilized = Number(job.consumed_hours || 0);
    }

    await job.save();
};

// List time logs pending approval (Foreman/Manager only)
router.get('/approvals/pending', requireSupervisor, async (req, res) => {
    try {
        const deny = requireForemanOrManager(req, res);
        if (deny) return;

        if (!requiresApprovalForTenant(req.tenant.supervisor_key)) {
            return res.json([]);
        }

        const query = {
            ...tenantQuery(req.tenant.supervisor_key),
            approval_status: 'pending'
        };

        const { start_date, end_date, technician_id } = req.query;
        if (technician_id) query.technician_id = technician_id;
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

        const logs = await TimeLog.find(query).sort({ log_date: -1, createdAt: -1 }).limit(500);

        // Enrich missing technician names for display in foreman approvals UI
        const missingNameIds = Array.from(
            new Set(
                (logs || [])
                    .filter((l) => l && l.technician_id && !l.technician_name)
                    .map((l) => String(l.technician_id))
            )
        );

        let nameById = {};
        if (missingNameIds.length) {
            const techs = await Technician.find({
                ...tenantQuery(req.tenant.supervisor_key),
                _id: { $in: missingNameIds }
            }).select({ _id: 1, name: 1 });
            nameById = (techs || []).reduce((acc, t) => {
                acc[String(t._id)] = t.name;
                return acc;
            }, {});
        }

        const hydrated = (logs || []).map((l) => {
            const obj = l?.toObject ? l.toObject() : l;
            if (!obj) return obj;
            if (!obj.technician_name && obj.technician_id) {
                obj.technician_name = nameById[String(obj.technician_id)] || obj.technician_name;
            }
            return obj;
        });

        res.json(hydrated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Approve a time log (partial approval supported)
router.put('/:id/approve', requireSupervisor, async (req, res) => {
    try {
        const deny = requireForemanOrManager(req, res);
        if (deny) return;

        if (!requiresApprovalForTenant(req.tenant.supervisor_key)) {
            return res.status(400).json({ error: 'Approval workflow is not enabled for this workshop' });
        }

        const entry = await TimeLog.findOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        if (!entry) return res.status(404).json({ error: 'Time log not found' });

        const submitted = Number(entry.hours_logged || 0);
        const desired = Number(req.body?.approved_hours);
        if (Number.isNaN(desired) || desired < 0) {
            return res.status(400).json({ error: 'approved_hours must be a number >= 0' });
        }
        if (desired > submitted + 1e-9) {
            return res.status(400).json({ error: 'approved_hours cannot exceed submitted hours' });
        }

        const prevApproved = Number(entry.approved_hours || 0);
        const nextApproved = Math.max(0, Math.min(submitted, desired));
        const deltaApproved = nextApproved - prevApproved;

        entry.approval_status = 'approved';
        entry.approved_hours = nextApproved;
        entry.approved_by = req.session.user?.email || null;
        entry.approved_at = new Date();
        entry.approval_note = typeof req.body?.note === 'string' ? req.body.note : (entry.approval_note || '');
        await entry.save();

        await updateJobForApprovedDelta({
            supervisorKey: req.tenant.supervisor_key,
            jobId: entry.job_id,
            subtaskId: entry.subtask_id,
            technicianId: entry.technician_id,
            deltaApproved
        });

        res.json(entry);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Decline a time log (approved hours become 0)
router.put('/:id/decline', requireSupervisor, async (req, res) => {
    try {
        const deny = requireForemanOrManager(req, res);
        if (deny) return;

        if (!requiresApprovalForTenant(req.tenant.supervisor_key)) {
            return res.status(400).json({ error: 'Approval workflow is not enabled for this workshop' });
        }

        const entry = await TimeLog.findOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        if (!entry) return res.status(404).json({ error: 'Time log not found' });

        const prevApproved = Number(entry.approved_hours || 0);
        const deltaApproved = 0 - prevApproved;

        entry.approval_status = 'declined';
        entry.approved_hours = 0;
        entry.approved_by = req.session.user?.email || null;
        entry.approved_at = new Date();
        entry.approval_note = typeof req.body?.note === 'string' ? req.body.note : (entry.approval_note || '');
        await entry.save();

        await updateJobForApprovedDelta({
            supervisorKey: req.tenant.supervisor_key,
            jobId: entry.job_id,
            subtaskId: entry.subtask_id,
            technicianId: entry.technician_id,
            deltaApproved
        });

        res.json(entry);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

const isJobFullyCompleteByAssignments = (jobDoc) => {
    if (!jobDoc) return false;
    for (const st of (jobDoc.subtasks || [])) {
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
    const st = (jobDoc.subtasks || []).id(subtaskId);
    if (!st) return;

    st.progress_by_technician = Array.isArray(st.progress_by_technician) ? st.progress_by_technician : [];
    const existing = st.progress_by_technician.find((p) => String(p?.technician_id) === String(technicianId));
    const pct = Math.max(0, Math.min(100, Number(progressPct || 0)));
    if (existing) {
        existing.progress_percentage = pct;
        if (!existing.started_at && pct > 1e-9) {
            existing.started_at = new Date();
        }
        if (pct >= 100 - 1e-9) {
            existing.completed = true;
            if (!existing.completed_at) existing.completed_at = new Date();
        } else {
            existing.completed = false;
            existing.completed_at = null;
        }
        existing.updated_at = new Date();
    } else {
        st.progress_by_technician.push({
            technician_id: String(technicianId),
            progress_percentage: pct,
            started_at: pct > 1e-9 ? new Date() : null,
            completed: pct >= 100 - 1e-9,
            completed_at: pct >= 100 - 1e-9 ? new Date() : null,
            updated_at: new Date()
        });
    }
    
    // Update overall stage status if all technicians are complete
    const allTechs = st.assigned_technicians || [];
    const allCompleted = allTechs.every(tech => {
        const progress = st.progress_by_technician?.find(p => String(p.technician_id) === String(tech.technician_id));
        return progress && progress.completed;
    });
    
    if (allCompleted) {
        st.status = 'completed';
        st.completed_at = new Date();
    } else if (pct > 1e-9) {
        st.status = 'in_progress';
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
    const holiday = getSouthAfricanHolidayInfo(dateObj);
    if (holiday.is_public_holiday) return 0; // Public holiday => all overtime
    if (dayIndex === 0 || dayIndex === 6) return 0; // Weekend => all overtime
    if (dayIndex === 5) return 7; // Friday
    return 8; // Mon-Thu
};

const normalizeDayOnly = (d) => normalizeHolidayDayOnly(d);

const getOvertimeMultiplierForDate = (dateObj) => {
    const day = normalizeDayOnly(dateObj);
    const holiday = getSouthAfricanHolidayInfo(day);
    if (holiday.is_public_holiday) return 2;
    const idx = day.getDay();
    if (idx === 0) return 2; // Sunday
    if (idx === 6) return 1.5; // Saturday
    return 1;
};

const computeJobStatus = (jobDoc) => {
    if (!jobDoc) return 'in_progress';
    if (jobDoc.status === 'completed') return 'completed';

    if (Boolean(jobDoc.completed)) return 'completed';

    const derivedPct = Number(
        jobDoc.aggregated_progress_percentage ?? jobDoc.progress_percentage ?? 0
    );
    if (derivedPct >= 100 - 1e-9) return 'completed';

    // Don't auto-complete based on consumed hours alone - let stage completion handle this
    // This prevents jobs from disappearing when hours are partially booked
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
        const avgDaily = workdaysRemaining > 0 ? remainingHours / workdaysRemaining : 0;
        if (avgDaily > 8.5) return 'at_risk';
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

    const holidayInfo = getSouthAfricanHolidayInfo(day);
    const multiplier = getOvertimeMultiplierForDate(day);
    const isAllOvertime = multiplier > 1 || holidayInfo.is_public_holiday || normalLimit === 0;

    // ✅ Validate inputs to prevent calculation errors
    if (!Array.isArray(logs)) {
        console.warn('No logs found for overtime calculation');
        return;
    }

    for (const l of logs) {
        try {
            const hrs = Number(l.hours_logged || 0);
            if (hrs < 0) {
                console.warn('Invalid hours_logged detected:', hrs);
                continue;
            }

            const normal = isAllOvertime ? 0 : Math.max(0, Math.min(hrs, normalRemaining));
            const ot = Math.max(0, hrs - normal);
            normalRemaining = Math.max(0, normalRemaining - normal);

            const payable = multiplier > 1 ? (hrs * multiplier) : hrs;
            const nextIsHoliday = Boolean(holidayInfo.is_public_holiday);
            const nextHolidayName = holidayInfo.public_holiday_name;

            // ✅ Validate calculated values
            const normalHours = Math.max(0, normal);
            const overtimeHours = Math.max(0, ot);
            const payableHours = Math.max(0, payable);
            const overtimeMultiplier = Math.max(1, multiplier);
            
            // ✅ Calculate hour_category based on log type and holiday status
            let hourCategory = null;
            if (l.is_idle) {
                if (holidayInfo.is_public_holiday) {
                    hourCategory = null; // Public holiday idle time doesn't count against utilization
                } else {
                    hourCategory = 'utilization_loss'; // Idle time reduces utilization
                }
            } else {
                if (holidayInfo.is_public_holiday) {
                    hourCategory = null; // Public holiday work doesn't count against utilization
                } else {
                    hourCategory = 'productive'; // Normal productive work
                }
            }

            const needsSave =
                Number(l.normal_hours || 0) !== normalHours ||
                Number(l.overtime_hours || 0) !== overtimeHours ||
                Boolean(l.is_public_holiday) !== nextIsHoliday ||
                (l.public_holiday_name || null) !== (nextHolidayName || null) ||
                Number(l.overtime_multiplier || 1) !== overtimeMultiplier ||
                Number(l.payable_hours || 0) !== payableHours ||
                l.hour_category !== hourCategory;

            if (needsSave) {
                l.normal_hours = normalHours;
                l.overtime_hours = overtimeHours;
                l.is_public_holiday = nextIsHoliday;
                l.public_holiday_name = nextHolidayName || null;
                l.overtime_multiplier = overtimeMultiplier;
                l.payable_hours = payableHours;
                l.hour_category = hourCategory;
                await l.save();
            }
        } catch (logError) {
            console.error('Error processing log for overtime:', logError, 'Log ID:', l._id);
            // Continue processing other logs even if one fails
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
            // ✅ Load job first before checking assignments
            jobForCheck = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                job_number: jobId
            });
            
            if (!jobForCheck) {
                return res.status(400).json({ error: 'Job not found' });
            }

            // ✅ Allow logging if technician is assigned to job level (even without specific subtask)
            const jobAssignment = jobForCheck.technicians?.find(t => 
                String(t.technician_id) === String(technicianId)
            );
            
            if (!jobAssignment) {
                return res.status(400).json({ error: 'Technician is not assigned to this job' });
            }
            
            // ✅ If technician has specific subtask assignment, require subtask_id
            // Otherwise, allow logging to job without subtask
            const hasSubtaskAssignment = jobForCheck.subtasks?.some(st => 
                st.assigned_technicians?.some(a => String(a.technician_id) === String(technicianId))
            );
            
            if (hasSubtaskAssignment && !subtaskId) {
                return res.status(400).json({ error: 'subtask_id is required for job logs' });
            }
            
            // Skip the rest of subtask validation if no specific subtask required
            if (!hasSubtaskAssignment) {
                subtaskId = null; // Allow logging to job without subtask
                // Continue to job validation logic
            } else {
                // Continue with subtask validation for assigned subtasks
            }

            if (jobForCheck.target_completion_date) {
                const target = normalizeDayOnly(jobForCheck.target_completion_date);
                const logDay = normalizeDayOnly(logDate);
                // Allow logging past target date; job will be considered at-risk.
            }

            const allocatedForJob = Number(jobForCheck.allocated_hours || 0);
            const consumedForJob = requiresApprovalForTenant(req.tenant.supervisor_key)
                ? await sumSubmittedJobHours({ supervisorKey: req.tenant.supervisor_key, jobId })
                : Number(jobForCheck.consumed_hours || 0);
            const remaining = Math.max(0, allocatedForJob - consumedForJob);
            if (deltaHours > remaining) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }

            // ✅ Only check subtask allocation if technician has subtask assignments
            if (subtaskId) {
                const allocation = getSubtaskAllocationForTechnician(jobForCheck, subtaskId, technicianId);
                if (!allocation) {
                    return res.status(400).json({ error: 'Technician is not assigned to this job stage' });
                }
                
                // ✅ Allow logging even if allocated_hours is 0 (for newly assigned technicians)
                // The supervisor will set proper allocations later
                resolvedSubtaskTitle = allocation.subtask_title;
                
                // ✅ Check allocated hours limit (only if allocated_hours > 0)
                const allocatedHours = Number(allocation.allocated_hours || 0);
                if (allocatedHours > 0) {
                    const existingStageLogs = await TimeLog.find({
                        ...tenantQuery(req.tenant.supervisor_key),
                        technician_id: technicianId,
                        job_id: jobId,
                        subtask_id: String(subtaskId),
                        is_idle: false
                    });
                    
                    // Use approved hours if approval is required, otherwise use logged hours
                    const alreadyLogged = existingStageLogs.reduce((sum, e) => {
                        if (needsApproval) {
                            return sum + Number(e.approved_hours || 0);
                        } else {
                            return sum + Number(e.hours_logged || 0);
                        }
                    }, 0);
                    
                    if ((alreadyLogged + hoursLogged) > (allocatedHours + 1e-9)) {
                        return res.status(400).json({ error: 'Not enough remaining hours on this job stage' });
                    }
                }
            }
        }
        
        // ✅ Define needsApproval before it's used
        const needsApproval = requiresApprovalForTenant(req.tenant.supervisor_key);
        const defaultStatus = needsApproval ? 'pending' : 'approved';

        // Continue with subtask validation for assigned subtasks

        let entry;
        if (existingSameJob) {
            existingSameJob.hours_logged = prevHoursForSameJob + hoursLogged;
            existingSameJob.is_idle = isIdle;
            existingSameJob.category = isIdle ? category : null;
            existingSameJob.category_detail = isIdle ? String(categoryDetail || '') : '';
            existingSameJob.subtask_id = isIdle ? null : String(subtaskId);
            existingSameJob.subtask_title = isIdle ? null : (resolvedSubtaskTitle || null);

            // Approval defaults:
            // - Component: auto-approved at hours_logged
            // - PDI/Rebuild: pending (approved hours start at 0)
            if (!needsApproval) {
                existingSameJob.approval_status = 'approved';
                existingSameJob.approved_hours = Number(existingSameJob.hours_logged || 0);
            } else {
                existingSameJob.approval_status = 'pending';
                existingSameJob.approved_hours = Number(existingSameJob.approved_hours || 0);
            }
            try {
                entry = await existingSameJob.save();
            } catch (saveError) {
                console.error('Error saving existing time entry:', saveError);
                return res.status(400).json({ error: 'Failed to save time entry: ' + saveError.message });
            }
        } else {
            entry = new TimeLog({
                supervisor_key: req.tenant.supervisor_key,
                technician_id: technicianId,
                job_id: jobId,
                subtask_id: isIdle ? null : String(subtaskId),
                subtask_title: isIdle ? null : (resolvedSubtaskTitle || null),
                hours_logged: hoursLogged,
                log_date: logDate,
                category: isIdle ? category : null,
                category_detail: isIdle ? String(categoryDetail || '') : '',
                is_idle: isIdle,
                normal_hours: 0,
                overtime_hours: 0,
                approval_status: defaultStatus,
                approved_hours: defaultStatus === 'approved' ? hoursLogged : 0,
                approved_by: null,
                approved_at: null,
                approval_note: ''
            });
            try {
                await entry.save();
            } catch (saveError) {
                console.error('Error creating new time entry:', saveError);
                return res.status(400).json({ error: 'Failed to create time entry: ' + saveError.message });
            }
        }

        try {
            await reallocateDayNormalOvertime(technicianId, logDate);
        } catch (error) {
            console.error('Error in reallocateDayNormalOvertime:', error);
            // Don't fail the entire request if overtime calculation fails
        }
        
        if (report && (report.work_completed || report.has_bottleneck)) {
            if (report.has_bottleneck && report.bottleneck_category === 'technical_complexity') {
                const desc = String(report.bottleneck_description || '').trim();
                const timeLost = Number(report.bottleneck_time_lost_hours);
                if (!desc) {
                    return res.status(400).json({ error: 'Technical Complexity requires a description of the issue' });
                }
                if (Number.isNaN(timeLost) || timeLost <= 0) {
                    return res.status(400).json({ error: 'Technical Complexity requires time lost (hours) greater than 0' });
                }
            }

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

                    if (report.bottleneck_category === 'technical_complexity') {
                        const inc = Math.max(0, Number(report.bottleneck_time_lost_hours || 0));
                        if (inc > 0) {
                            job.technical_complexity_hours = Number(job.technical_complexity_hours || 0) + inc;
                        }
                    }

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
        
        let alreadyLoggedStageHours = 0;

        if (!isIdle) {
            const job = jobForCheck || await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: jobId });
            if (job) {
                // For approval tenants (PDI/Rebuild), do NOT apply submitted hours to job until approved.
                const deltaApproved = needsApproval ? 0 : deltaHours;
                job.consumed_hours = Number(job.consumed_hours || 0) + deltaApproved;
                const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
                if (tech) {
                    tech.consumed_hours = Number(tech.consumed_hours || 0) + deltaApproved;
                }

                const allocated = Number(job.allocated_hours || 0);
                const newConsumed = Number(job.consumed_hours || 0);
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
        
        // Update monthly hours summary
        try {
            const entryYear = logDate.getFullYear();
            const entryMonth = logDate.getMonth() + 1;
            
            await MonthlyHoursSummary.updateMonthlySummary(
                req.tenant.supervisor_key,
                technicianId,
                entryYear,
                entryMonth,
                {
                    hours_logged: entry.hours_logged,
                    is_idle: entry.is_idle,
                    normal_hours: entry.normal_hours,
                    overtime_hours: entry.overtime_hours,
                    payable_hours: entry.payable_hours
                }
            );
        } catch (summaryError) {
            // Log error but don't fail the time entry creation
            console.error('Failed to update monthly summary:', summaryError);
        }
        
        res.status(201).json(entry);
    } catch (error) {
        if (error && error.code === 11000) {
            const keys = error?.keyPattern || error?.keyValue || {};
            const hint = (keys && (keys.log_date || keys.job_id) && !keys.subtask_id)
                ? ' (Your database likely still has an old unique index on {technician_id, job_id, log_date}. Drop that index so {technician_id, job_id, subtask_id, log_date} is the unique key.)'
                : '';
            return res.status(400).json({ error: `Duplicate log entry for same job and date${hint}` });
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

        const needsApproval = requiresApprovalForTenant(req.tenant.supervisor_key);

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
            ...tenantQuery(req.tenant.supervisor_key),
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

            const allocation = getSubtaskAllocationForTechnician(jobForCheck, subtaskId, existing.technician_id);
            if (!allocation) {
                return res.status(400).json({ error: 'Technician is not assigned to this job stage' });
            }

            const otherStageLogs = await TimeLog.find({
                ...tenantQuery(req.tenant.supervisor_key),
        //  chnician_id/ivestite_hours/payibne_h.tec are derived server-sidenician_id,
        // a d will b_ iecsmpttedgbyjreallocateDayNormalOb_id,
                subtask_id: String(subtaskId),
                is_idle: false,
                _id: { $ne: existing._id }
            });
            const alreadyLoggedStage = otherStageLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
            // ✅ Allow logging even if allocated_hours is 0 (for newly assigned technicians)
            const allocatedHours = Number(allocation.allocated_hours || 0);
            if (allocatedHours > 0 && (alreadyLoggedStage + newHours) > (allocatedHours + 1e-9)) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job stage' });
            }

            const allocatedForJob = Number(jobForCheck.allocated_hours || 0);
            const consumedForJob = needsApproval
                ? await sumSubmittedJobHours({ supervisorKey: req.tenant.supervisor_key, jobId: existing.job_id })
                : Number(jobForCheck.consumed_hours || 0);
            const remainingJob = Math.max(0, allocatedForJob - consumedForJob);
            const delta = newHours - Number(existing.hours_logged || 0);
            if (delta > remainingJob) {
                return res.status(400).json({ error: 'Not enough remaining hours on this job' });
            }
        }

        const normalLimit = getNormalLimitForDate(logDate);
        const normalUsed = otherDayLogs.reduce((sum, e) => sum + Number(e.normal_hours || 0), 0);
        const normalRemaining = Math.max(0, normalLimit - normalUsed);
        const normalHours = Math.max(0, Math.min(newHours, normalRemaining));
        const overtimeHours = Math.max(0, newHours - normalHours);

        // ✅ Validate calculated overtime values
        if (normalHours < 0 || overtimeHours < 0) {
            return res.status(400).json({ error: 'Invalid normal/overtime hours calculated' });
        }

        const prevHours = Number(existing.hours_logged || 0);
        const prevApproved = Number(existing.approved_hours || 0);
        existing.hours_logged = newHours;
        existing.is_idle = isIdle;
        existing.category = isIdle ? newCategory : null;
        existing.subtask_id = isIdle ? null : String(subtaskId);
        existing.normal_hours = normalHours;
        existing.overtime_hours = overtimeHours;

        // Approval behavior:
        // - Component: always keep logs approved and approved_hours == hours_logged
        // - PDI/Rebuild: if an approved log is edited, it must be re-approved (reset to pending)
        if (!needsApproval) {
            existing.approval_status = 'approved';
            existing.approved_hours = newHours;
        } else {
            if (existing.approval_status === 'approved' && prevApproved > 0) {
                // reverse previously approved hours from job totals
                await updateJobForApprovedDelta({
                    supervisorKey: req.tenant.supervisor_key,
                    jobId: existing.job_id,
                    subtaskId: existing.subtask_id,
                    technicianId: existing.technician_id,
                    deltaApproved: -prevApproved
                });
            }

            existing.approval_status = 'pending';
            existing.approved_hours = 0;
            existing.approved_by = null;
            existing.approved_at = null;
        }
        await existing.save();

        await reallocateDayNormalOvertime(existing.technician_id, logDate);

        if (!existing.is_idle) {
            // Only Component affects job totals during technician edits.
            // Approval tenants update job totals only on foreman approve/decline.
            if (!needsApproval) {
                const delta = newHours - prevHours;
                const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: existing.job_id });
                if (job) {
                    job.consumed_hours = Number(job.consumed_hours || 0) + delta;
                    const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(existing.technician_id));
                    if (tech) {
                        tech.consumed_hours = Number(tech.consumed_hours || 0) + delta;
                    }

                    const stId = existing.subtask_id;
                    if (stId) {
                        const allocation = getSubtaskAllocationForTechnician(job, stId, existing.technician_id);
                        const allocHours = Number(allocation?.allocated_hours || 0);
                        if (allocHours > 0) {
                            const stageLogs = await TimeLog.find({
                                ...tenantQuery(req.tenant.supervisor_key),
                                technician_id: existing.technician_id,
                                job_id: existing.job_id,
                                subtask_id: String(stId),
                                is_idle: false
                            });
                            const stageSum = stageLogs.reduce((sum, e) => sum + Number(e.hours_logged || 0), 0);
                            upsertSubtaskProgressForTechnician(job, stId, existing.technician_id, (stageSum / allocHours) * 100);
                        }
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

        const needsApproval = requiresApprovalForTenant(req.tenant.supervisor_key);
        const hours = !needsApproval ? Number(existing.hours_logged || 0) : Number(existing.approved_hours || 0);
        const jobId = existing.job_id;
        const technicianId = existing.technician_id;
        const isIdle = !!existing.is_idle;
        const subtaskId = existing.subtask_id;

        await TimeLog.deleteOne({ _id: existing._id });

        // ✅ Recalculate overtime after deletion
        try {
            await reallocateDayNormalOvertime(technicianId, existing.log_date);
        } catch (error) {
            console.error('Error in reallocateDayNormalOvertime after deletion:', error);
            // Don't fail the deletion if overtime calculation fails
        }

        if (!isIdle) {
            const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: jobId });
            if (job) {
                job.consumed_hours = Math.max(0, Number(job.consumed_hours || 0) - hours);
                const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
                if (tech) {
                    tech.consumed_hours = Math.max(0, Number(tech.consumed_hours || 0) - hours);
                }

                if (subtaskId) {
                    const allocation = getSubtaskAllocationForTechnician(job, subtaskId, technicianId);
                    const allocHours = Number(allocation?.allocated_hours || 0);
                    if (allocHours > 0) {
                        const stageLogs = await TimeLog.find({
                            ...tenantQuery(req.tenant.supervisor_key),
                            technician_id: technicianId,
                            job_id: jobId,
                            subtask_id: String(subtaskId),
                            is_idle: false
                        });
                        const stageSum = stageLogs.reduce((sum, e) => sum + (!needsApproval ? Number(e.hours_logged || 0) : Number(e.approved_hours || 0)), 0);
                        upsertSubtaskProgressForTechnician(job, subtaskId, technicianId, (stageSum / allocHours) * 100);
                    }
                }

                const allocated = Number(job.allocated_hours || 0);
                const consumed = Number(job.consumed_hours || 0);
                job.remaining_hours = Math.max(0, allocated - consumed);
                job.overrun_hours = Math.max(0, consumed - allocated);
                job.progress_percentage = allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : 0;
                job.status = computeJobStatus(job);
                await job.save();
            }
        }

        res.json({ message: 'Time log deleted' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Monthly Hours Summary endpoints
const MonthlyTransitionService = require('../services/monthlyTransitionService');

// Get monthly summaries for technicians
router.get('/monthly-summaries', requireAuth, async (req, res) => {
    try {
        const { technician_ids, start_date, end_date } = req.query;
        
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required' });
        }
        
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        let technicianIds = technician_ids;
        if (typeof technician_ids === 'string') {
            technicianIds = technician_ids.split(',').map(id => id.trim()).filter(id => id);
        }
        
        const summaries = await MonthlyHoursSummary.getSummariesForDateRange(
            req.tenant.supervisor_key,
            technicianIds,
            startDate,
            endDate
        );
        
        res.json(summaries);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get current month summary for a technician
router.get('/monthly-summary/current/:technicianId', requireAuth, async (req, res) => {
    try {
        const deny = requireSelfOrSupervisor(req, res, req.params.technicianId);
        if (deny) return;
        
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        
        const summary = await MonthlyHoursSummary.getOrCreateMonthlySummary(
            req.tenant.supervisor_key,
            req.params.technicianId,
            year,
            month
        );
        
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update monthly summary (called internally when time entries are created/updated)
router.post('/monthly-summary/update', requireAuth, async (req, res) => {
    try {
        const { technician_id, year, month, time_entry_data } = req.body;
        
        if (!technician_id || !year || !month || !time_entry_data) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Only supervisors can update summaries (or system calls)
        if (req.session.user?.type !== 'supervisor') {
            return res.status(403).json({ error: 'Supervisor access required' });
        }
        
        const summary = await MonthlyHoursSummary.updateMonthlySummary(
            req.tenant.supervisor_key,
            technician_id,
            year,
            month,
            time_entry_data
        );
        
        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear current month data (for new month transition)
router.post('/monthly-summary/clear-current', requireSupervisor, async (req, res) => {
    try {
        const deny = requireForemanOrManager(req, res);
        if (deny) return;
        
        const { technician_ids } = req.body;
        
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        
        let filter = {
            supervisor_key: req.tenant.supervisor_key,
            year: year,
            month: month
        };
        
        if (technician_ids && technician_ids.length > 0) {
            filter.technician_id = { $in: technician_ids };
        }
        
        const result = await MonthlyHoursSummary.deleteMany(filter);
        
        res.json({ 
            message: 'Current month summaries cleared successfully',
            deleted_count: result.deletedCount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get daily productive percentage data for technicians
router.get('/daily-productivity', requireAuth, async (req, res) => {
    try {
        const { technician_ids, start_date, end_date } = req.query;
        
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required' });
        }
        
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        
        let technicianIds = technician_ids;
        if (typeof technician_ids === 'string') {
            technicianIds = technician_ids.split(',').map(id => id.trim()).filter(id => id);
        }
        
        // Default to all technicians if none specified
        if (!technicianIds || technicianIds.length === 0) {
            const Technician = require('../models/Technician');
            const techs = await Technician.find({ ...tenantQuery(req.tenant.supervisor_key), status: 'active' });
            technicianIds = techs.map(t => t._id.toString());
        }
        
        const dailyProductivityData = {};
        
        console.log('🔍 Backend API called with:', {
            technicianIds,
            technicianIdsType: typeof technicianIds,
            startDate,
            endDate
        });
        
        for (const technicianId of technicianIds) {
            console.log(`🔍 Processing technician ${technicianId}...`);
            const dailyData = await TimeLog.calculateDailyProductivity(
                req.tenant.supervisor_key,
                technicianId,
                startDate,
                endDate
            );
            
            console.log(`🔍 Technician ${technicianId} returned ${dailyData.length} days of data`);
            dailyProductivityData[technicianId] = dailyData;
        }
        
        console.log('🔍 Final dailyProductivityData keys:', Object.keys(dailyProductivityData));
        console.log('🔍 Final dailyProductivityData sample:', {
            sampleTech: Object.keys(dailyProductivityData)[0],
            sampleData: dailyProductivityData[Object.keys(dailyProductivityData)[0]]
        });
        
        res.json(dailyProductivityData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Monthly transition endpoints
router.get('/monthly-transition/status', requireSupervisor, async (req, res) => {
    try {
        const status = await MonthlyTransitionService.getCurrentMonthStatus(req.tenant.supervisor_key);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/monthly-transition/perform', requireSupervisor, async (req, res) => {
    try {
        const deny = requireForemanOrManager(req, res);
        if (deny) return;
        
        const result = await MonthlyTransitionService.checkAndTransitionMonth(req.tenant.supervisor_key);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/monthly-transition/force-clear', requireSupervisor, async (req, res) => {
    try {
        const deny = requireForemanOrManager(req, res);
        if (deny) return;
        
        const { technician_ids } = req.body;
        const result = await MonthlyTransitionService.forceTransitionToCurrentMonth(
            req.tenant.supervisor_key, 
            technician_ids
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;