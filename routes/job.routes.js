const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const Technician = require('../models/Technician');
const TimeLog = require('../models/TimeLog');
const DailyTimeEntry = require('../models/DailyTimeEntry');
const JobReport = require('../models/JobReport');
const { requireAuth, requireSupervisor, tenantQuery } = require('../middleware/auth');
const mongoose = require('mongoose');

const DEFAULT_SUBTASK_TITLES = ['Washing', 'Stripping', 'Assembling & Painting', 'Testing'];

// ✅ Safe Assignment Logic (NO DUPLICATES)
const assignTechnicianToJob = async (jobId, technicianId, technicianName) => {
    const job = await Job.findById(jobId);
    
    if (!job) throw new Error("Job not found");
    
    // Prevent duplicates at job level
    const isAlreadyAssigned = job.technicians.some(tech => 
        String(tech.technician_id) === String(technicianId)
    );
    
    if (!isAlreadyAssigned) {
        job.technicians.push({
            technician_id: technicianId,
            technician_name: technicianName,
            confirmed_by_technician: false,
            confirmed_date: null,
            consumed_hours: 0
        });
    }
    
    // ✅ DON'T auto-assign to all subtasks
    // Technicians should only be assigned to specific subtasks by supervisor
    // This ensures they can only log hours to tasks they're actually assigned to
    
    await job.save();
    return job;
};

function normalizeSubtasksInput(subtasks) {
    if (!Array.isArray(subtasks) || !subtasks.length) return [];
    return subtasks
        .filter((st) => st && typeof st.title === 'string' && st.title.trim())
        .map((st) => {
            const allocatedHours = Number(st.allocated_hours || 0);
            const category = typeof st.category === 'string' && st.category.trim() ? st.category.trim() : null;
            const assigned = Array.isArray(st.assigned_technicians) ? st.assigned_technicians : [];
            const assignedNorm = assigned
                .filter((a) => a && a.technician_id)
                .map((a) => ({
                    technician_id: a.technician_id,
                    technician_name: a.technician_name || '',
                    allocated_hours: Number(a.allocated_hours || 0)
                }));

            return {
                category,
                title: st.title.trim(),
                allocated_hours: Number.isFinite(allocatedHours) ? Math.max(0, allocatedHours) : 0,
                assigned_technicians: assignedNorm,
                weight: typeof st.weight === 'number' ? st.weight : 1,
                progress_by_technician: Array.isArray(st.progress_by_technician) ? st.progress_by_technician : []
            };
        });
}

function isJobFullyCompleteByAssignments(jobDoc) {
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
}

function isLastRemainingTask(jobDoc, completedSubtaskId) {
    if (!jobDoc || !completedSubtaskId) return false;
    
    let totalRemainingTasks = 0;
    let completedTasksCount = 0;
    
    for (const st of (jobDoc.subtasks || [])) {
        for (const a of (st.assigned_technicians || [])) {
            const techId = a?.technician_id;
            if (!techId) continue;
            
            const p = (st.progress_by_technician || []).find((x) => String(x?.technician_id) === String(techId));
            const pct = Number(p?.progress_percentage || 0);
            const isCompleted = Boolean(p?.completed) || pct >= 100 - 1e-9;
            
            if (isCompleted) {
                completedTasksCount++;
            } else {
                totalRemainingTasks++;
            }
        }
    }
    
    // If this was the last remaining task, allow job completion
    return totalRemainingTasks <= 1;
}

function countTotalTasks(jobDoc) {
    if (!jobDoc) return 0;
    let totalTasks = 0;
    
    for (const st of (jobDoc.subtasks || [])) {
        for (const a of (st.assigned_technicians || [])) {
            if (a?.technician_id) totalTasks++;
        }
    }
    return totalTasks;
}

function countCompletedTasks(jobDoc) {
    if (!jobDoc) return 0;
    let completedTasks = 0;
    
    for (const st of (jobDoc.subtasks || [])) {
        for (const a of (st.assigned_technicians || [])) {
            if (!a?.technician_id) continue;
            
            const p = (st.progress_by_technician || []).find((x) => String(x?.technician_id) === String(a?.technician_id));
            const pct = Number(p?.progress_percentage || 0);
            const isCompleted = Boolean(p?.completed) || pct >= 100 - 1e-9;
            
            if (isCompleted) completedTasks++;
        }
    }
    return completedTasks;
}

// Manual stage completion (technician override)
router.put('/by-job/:jobNumber/subtasks/:subtaskId/complete', requireAuth, async (req, res) => {
    try {
        const technicianId = req.body?.technician_id || req.session?.user?.id;
        if (!technicianId) return res.status(400).json({ error: 'technician_id is required' });

        const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const st = (job.subtasks || []).id(req.params.subtaskId);
        if (!st) return res.status(404).json({ error: 'Subtask not found' });

        const isSupervisor = req.session?.user?.type === 'supervisor';
        if (!isSupervisor) {
            const assigned = Array.isArray(st.assigned_technicians) ? st.assigned_technicians : [];
            const isAssigned = assigned.some((a) => String(a?.technician_id) === String(technicianId));
            if (!isAssigned) return res.status(403).json({ error: 'Not allowed' });
        }

        st.progress_by_technician = Array.isArray(st.progress_by_technician) ? st.progress_by_technician : [];
        const existing = st.progress_by_technician.find((p) => String(p?.technician_id) === String(technicianId));
        if (existing) {
            existing.progress_percentage = 100;
            if (!existing.started_at) existing.started_at = new Date();
            existing.completed = true;
            if (!existing.completed_at) existing.completed_at = new Date();
            existing.updated_at = new Date();
        } else {
            st.progress_by_technician.push({
                technician_id: technicianId,
                progress_percentage: 100,
                started_at: new Date(),
                completed: true,
                completed_at: new Date(),
                updated_at: new Date()
            });
        }

        // Update job progress based on completed tasks (but don't auto-complete job)
        const allocated = Number(job.allocated_hours || 0);
        const consumed = Number(job.consumed_hours || 0);
        const remainingHours = allocated - consumed;
        
        // Calculate progress based on completed tasks vs total tasks
        const totalTasks = countTotalTasks(job);
        const completedTasks = countCompletedTasks(job);
        const taskBasedProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        
        // Update job progress to reflect task completions
        job.progress_percentage = Math.max(taskBasedProgress, job.progress_percentage || 0);
        job.remaining_hours = Math.max(0, remainingHours);
        
        // Only complete job if there are no remaining hours OR if this was the last remaining task
        if (job.status !== 'completed' && (remainingHours <= 0 || isLastRemainingTask(job, req.params.subtaskId))) {
            job.status = 'completed';
            job.progress_percentage = 100;
            job.remaining_hours = 0;
            job.actual_completion_date = new Date();
            job.total_hours_utilized = Number(job.consumed_hours || 0);
        }

        await job.save();
        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

function normalizeDayOnly(d) {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function computeAtRiskInfo(jobObj) {
    if (!jobObj) return { risk_reason: '', risk_reason_details: '' };

    const allocated = Number(jobObj.allocated_hours || 0);
    const consumed = Number(jobObj.consumed_hours || 0);

    if (Number(jobObj.bottleneck_count || 0) >= 2) {
        return {
            risk_reason: 'bottlenecks',
            risk_reason_details: `${Number(jobObj.bottleneck_count || 0)} issues reported on this job.`
        };
    }

    const today = normalizeDayOnly(new Date());
    const target = jobObj.target_completion_date ? normalizeDayOnly(jobObj.target_completion_date) : null;
    if (target && today > target) {
        return {
            risk_reason: 'overdue',
            risk_reason_details: `Target completion date was ${target.toLocaleDateString()}.`
        };
    }

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
        for (const t of (jobObj.technicians || [])) {
            if (t?.technician_id) techIds.add(t.technician_id.toString());
        }
        for (const st of (jobObj.subtasks || [])) {
            for (const a of (st?.assigned_technicians || [])) {
                if (a?.technician_id) techIds.add(a.technician_id.toString());
            }
        }
        const assignedCount = techIds.size || 1;
        const capacity = workdaysRemaining * 8 * assignedCount;
        if (remainingHours > capacity + 1e-9) {
            return {
                risk_reason: 'insufficient_capacity',
                risk_reason_details: `${remainingHours.toFixed(1)}h remaining but only ~${capacity.toFixed(1)}h capacity until target date (${workdaysRemaining} workdays × ${assignedCount} techs).`
            };
        }
    }

    return { risk_reason: 'at_risk', risk_reason_details: '' };
}

function computeDerivedStatus(jobObj) {
    if (!jobObj) return 'in_progress';
    if (jobObj.status === 'completed') return 'completed';

    if (Boolean(jobObj.completed)) return 'completed';

    const derivedPct = Number(
        jobObj.aggregated_progress_percentage ?? jobObj.progress_percentage ?? 0
    );
    if (derivedPct >= 100 - 1e-9) return 'completed';

    const allocated = Number(jobObj.allocated_hours || 0);
    const consumed = Number(jobObj.consumed_hours || 0);

    if (allocated > 0 && consumed >= allocated - 1e-9) return 'completed';
    if (allocated > 0 && consumed > allocated) return 'overrun';

    if (Number(jobObj.bottleneck_count || 0) >= 2) return 'at_risk';

    const today = normalizeDayOnly(new Date());
    const target = jobObj.target_completion_date ? normalizeDayOnly(jobObj.target_completion_date) : null;
    if (target && today > target) return 'at_risk';

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
        for (const t of (jobObj.technicians || [])) {
            if (t?.technician_id) techIds.add(t.technician_id.toString());
        }
        for (const st of (jobObj.subtasks || [])) {
            for (const a of (st?.assigned_technicians || [])) {
                if (a?.technician_id) techIds.add(a.technician_id.toString());
            }
        }
        const assignedCount = techIds.size || 1;
        const capacity = workdaysRemaining * 8 * assignedCount;
        if (remainingHours > capacity + 1e-9) return 'at_risk';
    }

    if (jobObj.status === 'pending_confirmation') return 'pending_confirmation';
    if (jobObj.status === 'active') return 'active';
    return 'in_progress';
}

function getDefaultSubtasks() {
    return DEFAULT_SUBTASK_TITLES.map((t) => ({
        category: null,
        title: t,
        allocated_hours: 0,
        assigned_technicians: [],
        weight: 1,
        progress_by_technician: []
    }));
}

async function enrichJobsWithTimeLogProgress(jobDocs, supervisorKey) {
    const docs = Array.isArray(jobDocs) ? jobDocs : (jobDocs ? [jobDocs] : []);
    if (!docs.length) return [];

    const jobNumbers = docs.map((j) => j?.job_number).filter(Boolean);
    if (!jobNumbers.length) {
        return docs.map((j) => {
            const obj = j.toObject();
            const firstTech = (obj.technicians || [])[0];
            return {
                ...obj,
                status: computeDerivedStatus(obj),
                assigned_technician_id: firstTech?.technician_id,
                assigned_technician_name: firstTech?.technician_name,
                aggregated_progress_percentage: 0,
                progress_by_technician: {}
            };
        });
    }

    const logAgg = await TimeLog.aggregate([
        {
            $match: {
                supervisor_key: supervisorKey,
                is_idle: false,
                job_id: { $in: jobNumbers },
                subtask_id: { $ne: null }
            }
        },
        {
            $group: {
                _id: {
                    job_id: '$job_id',
                    subtask_id: '$subtask_id',
                    technician_id: '$technician_id'
                },
                consumed: {
                    $sum: {
                        $cond: [
                            { $gt: ['$approved_hours', 0] },
                            '$approved_hours',
                            '$hours_logged'
                        ]
                    }
                }
            }
        }
    ]);

    const consumedByJob = new Map();
    const consumedByJobSubtask = new Map();
    const consumedByJobSubtaskTech = new Map();
    const consumedByJobTech = new Map();

    for (const row of logAgg) {
        const jobId = String(row?._id?.job_id || '');
        const subtaskId = String(row?._id?.subtask_id || '');
        const techId = String(row?._id?.technician_id || '');
        const hrs = Number(row?.consumed || 0);
        if (!jobId || !subtaskId || !techId) continue;

        const key = `${jobId}:${subtaskId}:${techId}`;
        consumedByJobSubtaskTech.set(key, hrs);
        consumedByJob.set(jobId, (consumedByJob.get(jobId) || 0) + hrs);
        consumedByJobSubtask.set(`${jobId}:${subtaskId}`, (consumedByJobSubtask.get(`${jobId}:${subtaskId}`) || 0) + hrs);
        consumedByJobTech.set(`${jobId}:${techId}`, (consumedByJobTech.get(`${jobId}:${techId}`) || 0) + hrs);
    }

    // Hydrate missing technician names (job-level + subtask-level assignments)
    const missingTechIds = new Set();
    for (const j of docs) {
        const obj = j?.toObject ? j.toObject() : j;
        for (const t of (obj?.technicians || [])) {
            if (t?.technician_id && !t?.technician_name) missingTechIds.add(String(t.technician_id));
        }
        for (const st of (obj?.subtasks || [])) {
            for (const a of (st?.assigned_technicians || [])) {
                if (a?.technician_id && !a?.technician_name) missingTechIds.add(String(a.technician_id));
            }
        }
    }

    let techNameById = {};
    if (missingTechIds.size) {
        const techs = await Technician.find({
            ...tenantQuery(supervisorKey),
            _id: { $in: Array.from(missingTechIds) }
        }).select({ _id: 1, name: 1 });
        techNameById = (techs || []).reduce((acc, t) => {
            acc[String(t._id)] = t.name;
            return acc;
        }, {});
    }

    return docs.map((j) => {
        const obj = j.toObject();
        obj.technicians = Array.isArray(obj.technicians) ? obj.technicians.map((t) => {
            if (!t) return t;
            if (!t.technician_name && t.technician_id) {
                return { ...t, technician_name: techNameById[String(t.technician_id)] || t.technician_name || '' };
            }
            return t;
        }) : [];

        obj.subtasks = Array.isArray(obj.subtasks) ? obj.subtasks.map((st) => {
            if (!st) return st;
            const assigned = Array.isArray(st.assigned_technicians) ? st.assigned_technicians : [];
            const nextAssigned = assigned.map((a) => {
                if (!a) return a;
                if (!a.technician_name && a.technician_id) {
                    return { ...a, technician_name: techNameById[String(a.technician_id)] || a.technician_name || '' };
                }
                return a;
            });
            return { ...st, assigned_technicians: nextAssigned };
        }) : [];

        const firstTech = (obj.technicians || [])[0];
        const jobAllocated = Number(obj.allocated_hours || 0);

        const totalConsumedAcrossSubtasks = consumedByJob.get(String(obj.job_number)) || 0;
        const overall = jobAllocated > 0
            ? Math.max(0, Math.min(100, (totalConsumedAcrossSubtasks / jobAllocated) * 100))
            : 0;

        const progressByTechnician = {};
        const techIds = new Set();
        for (const t of (obj.technicians || [])) {
            if (t?.technician_id) techIds.add(String(t.technician_id));
        }
        for (const st of (obj.subtasks || [])) {
            for (const a of (st?.assigned_technicians || [])) {
                if (a?.technician_id) techIds.add(String(a.technician_id));
            }
        }
        for (const techId of techIds) {
            const consumedForTech = consumedByJobTech.get(`${String(obj.job_number)}:${techId}`) || 0;
            progressByTechnician[techId] = jobAllocated > 0
                ? Math.max(0, Math.min(100, (consumedForTech / jobAllocated) * 100))
                : 0;
        }

        const subtasks = (obj.subtasks || []).map((st) => {
            const subtaskId = String(st?._id || st?.id || '');
            const subtaskAllocated = Number(st?.allocated_hours || 0);
            const allocatedHours = subtaskAllocated > 0 ? subtaskAllocated : jobAllocated;

            const subtaskConsumed = subtaskId
                ? (consumedByJobSubtask.get(`${String(obj.job_number)}:${subtaskId}`) || 0)
                : 0;
            const subtaskRemaining = Math.max(0, allocatedHours - subtaskConsumed);

            const assigned = Array.isArray(st?.assigned_technicians) ? st.assigned_technicians : [];

            const storedProgress = Array.isArray(st?.progress_by_technician) ? st.progress_by_technician : [];
            const storedByTechId = new Map(
                storedProgress
                    .filter((p) => p && p.technician_id)
                    .map((p) => [String(p.technician_id), p])
            );

            const nextProgress = assigned.map((a) => {
                const techId = String(a?.technician_id || '');
                const consumed = techId && subtaskId
                    ? (consumedByJobSubtaskTech.get(`${String(obj.job_number)}:${subtaskId}:${techId}`) || 0)
                    : 0;

                const techAllocated = Number(a?.allocated_hours || 0);
                const denomAllocated = techAllocated > 0 ? techAllocated : allocatedHours;
                const pct = denomAllocated > 0
                    ? Math.max(0, Math.min(100, (consumed / denomAllocated) * 100))
                    : 0;

                const stored = storedByTechId.get(techId);
                const storedCompleted = Boolean(stored?.completed);
                const storedCompletedAt = stored?.completed_at ? new Date(stored.completed_at) : null;
                const storedStartedAt = stored?.started_at ? new Date(stored.started_at) : null;

                const completed = storedCompleted || pct >= 100 - 1e-9;
                const completedAt = storedCompletedAt;

                return {
                    technician_id: a.technician_id,
                    progress_percentage: pct,
                    started_at: storedStartedAt,
                    completed,
                    completed_at: completedAt,
                    updated_at: new Date()
                };
            });

            return {
                ...st,
                consumed_hours: subtaskConsumed,
                remaining_hours: subtaskRemaining,
                progress_by_technician: nextProgress
            };
        });

        return {
            ...obj,
            subtasks,
            status: computeDerivedStatus({
                ...obj,
                aggregated_progress_percentage: overall,
                consumed_hours: totalConsumedAcrossSubtasks
            }),
            assigned_technician_id: firstTech?.technician_id,
            assigned_technician_name: firstTech?.technician_name,
            aggregated_progress_percentage: overall,
            progress_by_technician: progressByTechnician,
            ...(computeDerivedStatus({
                ...obj,
                aggregated_progress_percentage: overall,
                consumed_hours: totalConsumedAcrossSubtasks
            }) === 'at_risk'
                ? computeAtRiskInfo({
                    ...obj,
                    aggregated_progress_percentage: overall,
                    consumed_hours: totalConsumedAcrossSubtasks
                })
                : { risk_reason: '', risk_reason_details: '' })
        };
    });
}

// Confirm/accept a job assignment for a technician (by Job ID)
router.put('/by-job/:jobNumber/confirm', requireAuth, async (req, res) => {
    try {
        const technicianId = req.body?.technician_id || req.body?.technicianId || req.session?.user?.id;
        if (!technicianId) return res.status(400).json({ error: 'technician_id is required' });

        let job = await Job.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            job_number: req.params.jobNumber
        });

        // Some legacy clients/data may pass a Mongo _id instead of job_number.
        // If the param looks like an ObjectId, try resolving by _id as well.
        if (!job && mongoose.Types.ObjectId.isValid(String(req.params.jobNumber))) {
            job = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                _id: req.params.jobNumber
            });
        }

        // Fallback for legacy jobs created before tenant isolation (no supervisor_key set)
        if (!job && req.tenant?.supervisor_key && req.tenant.supervisor_key !== 'component') {
            job = await Job.findOne({
                job_number: req.params.jobNumber,
                $or: [
                    { supervisor_key: { $exists: false } },
                    { supervisor_key: null }
                ]
            });
        }
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
        if (!tech) return res.status(404).json({ error: 'Technician is not assigned to this job' });

        tech.confirmed_by_technician = true;
        tech.confirmed_date = new Date();

        if (job.status === 'pending_confirmation') {
            job.status = 'active';
        }

        const auditEntry = {
            actor_email: req.session.user?.email || '',
            actor_role: req.session.user?.role || 'supervisor',
            at: new Date(),
            type: 'technician_confirmed_job',
            details: {
                technician_id: String(technicianId),
                job_number: String(job.job_number)
            }
        };

        // Backward compatibility: some environments previously stored audit_history as a string.
        if (Array.isArray(job.audit_history)) {
            job.audit_history.push(auditEntry);
        } else if (typeof job.audit_history === 'string') {
            const line = JSON.stringify(auditEntry);
            job.audit_history = job.audit_history ? `${job.audit_history}\n${line}` : line;
        } else {
            job.audit_history = [auditEntry];
        }

        await job.save();

        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        console.error('Confirm job failed', {
            jobParam: req.params.jobNumber,
            tenant: req.tenant?.supervisor_key,
            technicianId: req.body?.technician_id || req.session?.user?.id,
            errorName: error?.name,
            errorMessage: error?.message
        });
        res.status(500).json({ error: error.message, name: error?.name || 'Error' });
    }
});

// Assign/add an additional technician to an existing job (by Job ID)
router.put('/by-job/:jobNumber/assign-technician', requireSupervisor, async (req, res) => {
    try {
        const technicianId = req.body?.technician_id;
        let technicianName = req.body?.technician_name || '';

        if (!technicianId) {
            return res.status(400).json({ error: 'technician_id is required' });
        }

        const job = await Job.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            job_number: req.params.jobNumber
        });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        if (!technicianName) {
            const tech = await Technician.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                _id: technicianId
            });
            if (!tech) return res.status(400).json({ error: 'Technician not found' });
            technicianName = tech.name;
        }

        try {
            const updatedJob = await assignTechnicianToJob(job._id, technicianId, technicianName);
            res.json(updatedJob);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get all jobs
router.get('/', requireAuth, async (req, res) => {
    try {
        const jobs = await Job.find({
            ...tenantQuery(req.tenant.supervisor_key)
        }).sort({ createdAt: -1 }).limit(200);
        const enriched = await enrichJobsWithTimeLogProgress(jobs, req.tenant.supervisor_key);
        res.json(enriched);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get jobs for a technician
router.get('/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const technicianId = req.params.technicianId;
        const jobs = await Job.find({
            ...tenantQuery(req.tenant.supervisor_key),
            $or: [
                { 'technicians.technician_id': technicianId },
                { 'subtasks.assigned_technicians.technician_id': technicianId }
            ]
        }).sort({ createdAt: -1 }).limit(200);
        const enriched = await enrichJobsWithTimeLogProgress(jobs, req.tenant.supervisor_key);
        res.json(enriched);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a job by Job ID (job_number)
router.get('/by-job/:jobNumber', requireAuth, async (req, res) => {
    try {
        const job = await Job.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            job_number: req.params.jobNumber
        });
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Recover Technical Complexity hours (Option A)
router.post('/by-job/:jobNumber/recover-technical-complexity', requireSupervisor, async (req, res) => {
    try {
        const job = await Job.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            job_number: req.params.jobNumber
        });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const allocated = Number(job.allocated_hours || 0);
        const consumed = Number(job.consumed_hours || 0);
        const remaining = Number(job.remaining_hours ?? Math.max(0, allocated - consumed));

        // Only allowed once allocated hours are fully consumed
        if (remaining > 1e-9) {
            return res.status(400).json({ error: 'Recovery is only available once allocated job hours are fully consumed' });
        }

        const totalTC = Number(job.technical_complexity_hours || 0);
        const recoveredAlready = Number(job.recovered_technical_complexity_hours || 0);
        const unrecovered = Math.max(0, totalTC - recoveredAlready);
        if (unrecovered <= 1e-9) {
            return res.status(400).json({ error: 'No unrecovered technical complexity hours available for this job' });
        }

        const prevAllocated = allocated;
        if (job.base_allocated_hours === null || typeof job.base_allocated_hours === 'undefined') {
            job.base_allocated_hours = prevAllocated;
        }

        const nextAllocated = prevAllocated + unrecovered;
        job.allocated_hours = nextAllocated;
        job.recovered_technical_complexity_hours = recoveredAlready + unrecovered;

        // Recalculate derived job metrics
        const nextRemaining = Math.max(0, nextAllocated - consumed);
        const nextOverrun = Math.max(0, consumed - nextAllocated);
        const nextProgress = nextAllocated > 0 ? (consumed / nextAllocated) * 100 : 0;
        job.remaining_hours = nextRemaining;
        job.overrun_hours = nextOverrun;
        job.progress_percentage = Math.min(100, nextProgress);
        job.status = computeDerivedStatus(job);

        job.audit_history = Array.isArray(job.audit_history) ? job.audit_history : [];
        job.audit_history.push({
            actor_email: req.session.user?.email || '',
            actor_role: req.session.user?.role || 'supervisor',
            at: new Date(),
            type: 'recovered_technical_complexity_hours',
            details: {
                added_hours: unrecovered,
                prev_allocated_hours: prevAllocated,
                next_allocated_hours: nextAllocated,
                total_technical_complexity_hours: totalTC,
                recovered_total_after: recoveredAlready + unrecovered
            }
        });

        await job.save();
        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Create job
router.post('/', requireSupervisor, async (req, res) => {
    try {
        const body = req.body || {};
        const technicians = Array.isArray(body.technicians) ? body.technicians : [];

        // If job_number already exists, treat this as "assign another technician" instead of creating a new job
        if (body.job_number) {
            const existingJob = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                job_number: body.job_number
            });
            if (existingJob) {
                const technicianId = body.assigned_technician_id || body.technicians?.[0]?.technician_id;
                let technicianName = body.assigned_technician_name || body.technicians?.[0]?.technician_name || '';

                if (!technicianId) {
                    return res.status(409).json({
                        error: 'Job number already exists. Provide a technician to assign to this existing job.'
                    });
                }

                if (!technicianName) {
                    const tech = await Technician.findById(technicianId);
                    if (!tech) return res.status(400).json({ error: 'Technician not found' });
                    technicianName = tech.name;
                }

                // ✅ Use safe assignment logic instead
                try {
                    await assignTechnicianToJob(existingJob._id, technicianId, technicianName);
                } catch (error) {
                    // Technician already assigned - continue
                }

                // Do not block other technicians by resetting an already-active job back to pending_confirmation
                if (!existingJob.status) {
                    existingJob.status = 'pending_confirmation';
                }
                await existingJob.save();

                const enriched = await enrichJobsWithTimeLogProgress([existingJob], req.tenant.supervisor_key);
                return res.json(enriched[0]);
            }
        }

        // ✅ Handle single technician assignment with safe logic
        if (!technicians.length && body.assigned_technician_id) {
            const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: body.job_number });
            if (job) {
                try {
                    await assignTechnicianToJob(job._id, body.assigned_technician_id, body.assigned_technician_name || '');
                } catch (error) {
                    // Technician already assigned - continue
                }
            }
        }

        const jobData = {
            supervisor_key: req.tenant.supervisor_key,
            job_number: body.job_number,
            description: body.description,
            allocated_hours: Number(body.allocated_hours || 0),
            remaining_hours: Number(body.remaining_hours || body.allocated_hours || 0),
            consumed_hours: Number(body.consumed_hours || 0),
            progress_percentage: Number(body.progress_percentage || 0),
            status: body.status || 'pending_confirmation',
            bottleneck_count: Number(body.bottleneck_count || 0),
            start_date: body.start_date,
            target_completion_date: body.target_completion_date,
            technicians,
            subtasks: normalizeSubtasksInput(body.subtasks) || getDefaultSubtasks()
        };

        const totalSubtaskAllocated = (jobData.subtasks || []).reduce((sum, st) => sum + Number(st.allocated_hours || 0), 0);
        const jobAllocated = Number(jobData.allocated_hours || 0);
        if (Number.isFinite(jobAllocated) && jobAllocated > 0 && totalSubtaskAllocated > jobAllocated) {
            return res.status(400).json({ error: 'Sum of subtask allocated hours cannot exceed job allocated hours' });
        }

        const job = new Job(jobData);
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ error: 'Job number already exists (possibly in another tenant). Use a different job number or migrate the DB index to be unique per supervisor_key.' });
        }
        res.status(400).json({ error: error.message });
    }
});

// Update a job by Job ID (job_number)
router.put('/by-job/:jobNumber', requireSupervisor, async (req, res) => {
    try {
        const job = await Job.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            job_number: req.params.jobNumber
        });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const body = req.body || {};
        const prevSnapshot = {
            job_number: job.job_number,
            description: job.description,
            allocated_hours: job.allocated_hours,
            status: job.status,
            technicians: job.technicians,
            start_date: job.start_date,
            target_completion_date: job.target_completion_date,
            subtasks: job.subtasks
        };

        const prevJobNumber = String(job.job_number);
        const nextJobNumber = typeof body.job_number === 'string' ? body.job_number.trim() : prevJobNumber;
        if (!nextJobNumber) return res.status(400).json({ error: 'job_number is required' });

        if (nextJobNumber !== prevJobNumber) {
            const exists = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                job_number: nextJobNumber
            });
            if (exists) return res.status(409).json({ error: 'Job number already exists' });
            job.job_number = nextJobNumber;
        }

        if (typeof body.description === 'string') job.description = body.description;
        if (typeof body.status === 'string') job.status = body.status;
        if (Object.prototype.hasOwnProperty.call(body, 'start_date')) job.start_date = body.start_date ? new Date(body.start_date) : null;
        if (Object.prototype.hasOwnProperty.call(body, 'target_completion_date')) job.target_completion_date = body.target_completion_date ? new Date(body.target_completion_date) : null;

        if (Object.prototype.hasOwnProperty.call(body, 'technicians') && Array.isArray(body.technicians)) {
            const prevTechIds = new Set((job.technicians || []).map((t) => String(t?.technician_id || '')).filter(Boolean));
            const nextTechs = body.technicians
                .filter((t) => t && t.technician_id)
                .map((t) => ({
                    technician_id: t.technician_id,
                    technician_name: t.technician_name || '',
                    confirmed_by_technician: !!t.confirmed_by_technician,
                    confirmed_date: t.confirmed_date ? new Date(t.confirmed_date) : null,
                    consumed_hours: Number(t.consumed_hours || 0)
                }));

            const nextTechIds = new Set(nextTechs.map((t) => String(t?.technician_id || '')).filter(Boolean));
            const removedTechIds = Array.from(prevTechIds).filter((id) => !nextTechIds.has(id));

            job.technicians = nextTechs;

            // Fully remove deleted technicians from all stage assignments + stage progress
            if (removedTechIds.length) {
                for (const st of (job.subtasks || [])) {
                    if (Array.isArray(st.assigned_technicians)) {
                        st.assigned_technicians = st.assigned_technicians.filter(
                            (a) => !removedTechIds.includes(String(a?.technician_id || ''))
                        );
                    }
                    if (Array.isArray(st.progress_by_technician)) {
                        st.progress_by_technician = st.progress_by_technician.filter(
                            (p) => !removedTechIds.includes(String(p?.technician_id || ''))
                        );
                    }
                }
            }
        }

        const prevAllocated = Number(job.allocated_hours || 0);
        if (Object.prototype.hasOwnProperty.call(body, 'allocated_hours')) {
            const nextAllocated = Number(body.allocated_hours || 0);
            if (!Number.isNaN(nextAllocated) && nextAllocated >= 0) {
                if (job.base_allocated_hours === null || typeof job.base_allocated_hours === 'undefined') {
                    job.base_allocated_hours = prevAllocated;
                }
                job.allocated_hours = nextAllocated;

                const consumed = Number(job.consumed_hours || 0);
                job.remaining_hours = Math.max(0, nextAllocated - consumed);
                job.overrun_hours = Math.max(0, consumed - nextAllocated);
                job.progress_percentage = Math.min(100, nextAllocated > 0 ? (consumed / nextAllocated) * 100 : 0);
            }
        }

        if (Object.prototype.hasOwnProperty.call(body, 'subtasks')) {
            job.subtasks = normalizeSubtasksInput(body.subtasks);
        }

        const totalSubtaskAllocated = (job.subtasks || []).reduce((sum, st) => sum + Number(st.allocated_hours || 0), 0);
        const jobAllocated = Number(job.allocated_hours || 0);
        if (Number.isFinite(jobAllocated) && jobAllocated > 0 && totalSubtaskAllocated > jobAllocated) {
            return res.status(400).json({ error: 'Sum of subtask allocated hours cannot exceed job allocated hours' });
        }

        job.audit_history = Array.isArray(job.audit_history) ? job.audit_history : [];
        job.audit_history.push({
            actor_email: req.session.user?.email || '',
            actor_role: req.session.user?.role || 'supervisor',
            at: new Date(),
            type: 'job_updated',
            details: {
                previous: prevSnapshot,
                next: {
                    job_number: job.job_number,
                    description: job.description,
                    allocated_hours: job.allocated_hours,
                    status: job.status,
                    technicians: job.technicians,
                    start_date: job.start_date,
                    target_completion_date: job.target_completion_date,
                    subtasks: job.subtasks
                }
            }
        });

        await job.save();

        if (nextJobNumber !== prevJobNumber) {
            const tenantFilter = tenantQuery(req.tenant.supervisor_key);
            await TimeLog.updateMany(
                { ...tenantFilter, job_id: prevJobNumber },
                { $set: { job_id: nextJobNumber } }
            );
            await DailyTimeEntry.updateMany(
                { ...tenantFilter, job_id: prevJobNumber },
                { $set: { job_id: nextJobNumber, job_number: nextJobNumber } }
            );
            await JobReport.updateMany(
                { ...tenantFilter, job_id: prevJobNumber },
                { $set: { job_id: nextJobNumber, job_number: nextJobNumber } }
            );
        }

        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update job (legacy endpoint, supports old fields)
router.put('/:id', requireSupervisor, async (req, res) => {
    try {
        const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const body = req.body || {};

        const prevAllocated = Number(job.allocated_hours || 0);

        // Legacy reassignment fields -> update first technician assignment
        if (body.assigned_technician_id) {
            const newFirst = {
                technician_id: body.assigned_technician_id,
                technician_name: body.assigned_technician_name || ''
            };

            const existingIdx = (job.technicians || []).findIndex(
                (t) => t.technician_id && t.technician_id.toString() === String(body.assigned_technician_id)
            );

            if (existingIdx >= 0) {
                const existing = job.technicians[existingIdx];
                existing.technician_name = newFirst.technician_name;
                // Move to front
                job.technicians.splice(existingIdx, 1);
                job.technicians.unshift(existing);
            } else {
                job.technicians.unshift(newFirst);
            }
        }

        // Legacy confirmation fields apply to the intended technician
        // (technician_id if provided, else assigned_technician_id, else logged-in technician)
        if (typeof body.confirmed_by_technician === 'boolean') {
            const technicianId = body.technician_id || body.assigned_technician_id || req.session?.user?.id;
            const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
            if (tech) {
                tech.confirmed_by_technician = body.confirmed_by_technician;
                tech.confirmed_date = body.confirmed_by_technician ? (body.confirmed_date ? new Date(body.confirmed_date) : new Date()) : null;
            }
        }

        // Apply remaining updatable fields (excluding deprecated ones)
        const blocked = new Set([
            'assigned_technician_id',
            'assigned_technician_name',
            'confirmed_by_technician',
            'confirmed_date',
            'technician_id'
        ]);

        for (const [key, value] of Object.entries(body)) {
            if (blocked.has(key)) continue;
            job.set(key, value);
        }

        // If allocated hours changed, keep derived metrics consistent
        if (Object.prototype.hasOwnProperty.call(body, 'allocated_hours')) {
            const allocated = Number(job.allocated_hours || 0);
            const consumed = Number(job.consumed_hours || 0);
            if (!Number.isNaN(allocated) && allocated >= 0 && allocated !== prevAllocated) {
                const remaining = Math.max(0, allocated - consumed);
                const overrunHours = Math.max(0, consumed - allocated);
                const progress = allocated > 0 ? (consumed / allocated) * 100 : 0;

                job.remaining_hours = remaining;
                job.overrun_hours = overrunHours;
                job.progress_percentage = Math.min(100, progress);

                if (job.status !== 'completed') {
                    job.status = consumed > allocated ? 'overrun' : 'in_progress';
                }
            }
        }

        await job.save();

        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/by-job/:jobNumber/subtasks', requireSupervisor, async (req, res) => {
    try {
        const { title, weight, allocated_hours, assigned_technicians } = req.body || {};
        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const alloc = Number(allocated_hours || 0);
        const newAllocated = Number.isFinite(alloc) ? Math.max(0, alloc) : 0;

        const candidateSubtasks = [...(job.subtasks || []), { allocated_hours: newAllocated }];
        const totalSubtaskAllocated = candidateSubtasks.reduce((sum, st) => sum + Number(st.allocated_hours || 0), 0);
        const jobAllocated = Number(job.allocated_hours || 0);
        if (Number.isFinite(jobAllocated) && jobAllocated > 0 && totalSubtaskAllocated > jobAllocated) {
            return res.status(400).json({ error: 'Sum of subtask allocated hours cannot exceed job allocated hours' });
        }

        const assigned = Array.isArray(assigned_technicians) ? assigned_technicians : [];
        const assignedNorm = assigned
            .filter((a) => a && a.technician_id)
            .map((a) => ({
                technician_id: a.technician_id,
                technician_name: a.technician_name || '',
                allocated_hours: Number(a.allocated_hours || 0)
            }));

        job.subtasks.push({
            title,
            allocated_hours: newAllocated,
            assigned_technicians: assignedNorm,
            weight: typeof weight === 'number' ? weight : 1,
            progress_by_technician: []
        });
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.put('/by-job/:jobNumber/subtasks/:subtaskId', requireSupervisor, async (req, res) => {
    try {
        const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const st = job.subtasks.id(req.params.subtaskId);
        if (!st) return res.status(404).json({ error: 'Subtask not found' });

        if (typeof req.body.title === 'string') st.title = req.body.title;
        if (typeof req.body.weight === 'number') st.weight = req.body.weight;

        if (Object.prototype.hasOwnProperty.call(req.body, 'allocated_hours')) {
            const alloc = Number(req.body.allocated_hours || 0);
            st.allocated_hours = Number.isFinite(alloc) ? Math.max(0, alloc) : 0;
        }

        if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_technicians')) {
            const assigned = Array.isArray(req.body.assigned_technicians) ? req.body.assigned_technicians : [];
            st.assigned_technicians = assigned
                .filter((a) => a && a.technician_id)
                .map((a) => ({
                    technician_id: a.technician_id,
                    technician_name: a.technician_name || '',
                    allocated_hours: Number(a.allocated_hours || 0)
                }));
        }

        const totalSubtaskAllocated = (job.subtasks || []).reduce((sum, s) => sum + Number(s.allocated_hours || 0), 0);
        const jobAllocated = Number(job.allocated_hours || 0);
        if (Number.isFinite(jobAllocated) && jobAllocated > 0 && totalSubtaskAllocated > jobAllocated) {
            return res.status(400).json({ error: 'Sum of subtask allocated hours cannot exceed job allocated hours' });
        }

        await job.save();
        res.json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/by-job/:jobNumber/subtasks/:subtaskId', requireSupervisor, async (req, res) => {
    try {
        const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const st = job.subtasks.id(req.params.subtaskId);
        if (!st) return res.status(404).json({ error: 'Subtask not found' });

        st.deleteOne();
        await job.save();
        res.json(job);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/by-job/:jobNumber/subtasks/:subtaskId/progress', requireAuth, async (req, res) => {
    try {
        const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete job
router.delete('/:id', requireSupervisor, async (req, res) => {
    try {
        await Job.deleteOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        res.json({ message: 'Job deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;