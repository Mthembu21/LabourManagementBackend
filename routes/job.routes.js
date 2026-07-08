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
        
        // Only complete job when every assigned technician on every subtask has reached 100%.
        // isLastRemainingTask was removed: it returned true when totalRemainingTasks <= 1,
        // which fired prematurely while one task was still pending.
        if (job.status !== 'completed' && isJobFullyCompleteByAssignments(job)) {
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

// Reopen completed job
router.put('/by-job/:jobNumber/reopen', requireAuth, async (req, res) => {
    try {
        const technicianId = req.body?.technician_id || req.session?.user?.id;
        const reason = req.body?.reason || 'Job mistakenly marked as completed - has remaining hours';
        
        if (!technicianId) return res.status(400).json({ error: 'technician_id is required' });

        const job = await Job.findOne({ ...tenantQuery(req.tenant.supervisor_key), job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        if (job.status !== 'completed') {
            return res.status(400).json({ error: 'Job is not completed' });
        }

        const isSupervisor = req.session?.user?.type === 'supervisor';
        if (!isSupervisor) {
            // Check if technician is assigned to this job
            const isAssigned = (job.technicians || []).some(t => String(t?.technician_id) === String(technicianId)) ||
                (job.subtasks || []).some(st => 
                    (st.assigned_technicians || []).some(a => String(a?.technician_id) === String(technicianId))
                );
            if (!isAssigned) return res.status(403).json({ error: 'Not assigned to this job' });
        }

        // Check if job has remaining hours
        const allocated = Number(job.allocated_hours || 0);
        const consumed = Number(job.consumed_hours || 0);
        if (allocated <= consumed) {
            return res.status(400).json({ error: 'No remaining hours to reopen job' });
        }

        // Reopen the job
        job.status = 'active';
        job.progress_percentage = Math.max(0, ((consumed / allocated) * 100) - 5); // Slightly reduce progress
        job.remaining_hours = allocated - consumed;
        job.actual_completion_date = null;
        job.total_hours_utilized = null;

        // Add re-open history
        if (!job.reopen_history) job.reopen_history = [];
        job.reopen_history.push({
            reopened_by: technicianId,
            reopened_at: new Date(),
            reason: reason,
            previous_status: 'completed',
            consumed_hours_at_reopen: consumed,
            allocated_hours_at_reopen: allocated
        });

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

async function enrichJobsWithTimeLogProgress(jobDocs, supervisorKeyOrKeys) {
    const docs = Array.isArray(jobDocs) ? jobDocs : (jobDocs ? [jobDocs] : []);
    if (!docs.length) return [];

    // Support single key or array of keys (for cross-supervisor enrichment)
    const supervisorKeys = Array.isArray(supervisorKeyOrKeys) ? supervisorKeyOrKeys : [supervisorKeyOrKeys];
    const supervisorKey = supervisorKeys[0]; // keep backward-compat alias
    const supervisorKeyMatch = supervisorKeys.length === 1 ? supervisorKeys[0] : { $in: supervisorKeys };

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

    // Two parallel aggregations:
    // 1. Per-subtask breakdown (subtask_id required) — drives per-task progress bars.
    // 2. Job-level total (all non-idle logs) — drives overall job progress %.
    //    Hours logged against a job without a subtask (pre-subtask data, legacy imports)
    //    are invisible in agg 1 but counted correctly in agg 2.
    const [logAgg, jobLevelAgg] = await Promise.all([
        TimeLog.aggregate([
            {
                $match: {
                    supervisor_key: supervisorKeyMatch,
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
        ]),
        TimeLog.aggregate([
            {
                $match: {
                    supervisor_key: supervisorKeyMatch,
                    is_idle: false,
                    job_id: { $in: jobNumbers }
                }
            },
            {
                $group: {
                    _id: '$job_id',
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
        ])
    ]);

    // Map from job_number → true total consumed hours (all logs, not just subtask-linked)
    const jobLevelConsumedMap = new Map(
        jobLevelAgg.map(r => [String(r._id), Number(r.consumed || 0)])
    );

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

        // Use the full-job aggregate so hours logged without a subtask_id are included.
        const totalConsumedAcrossSubtasks = jobLevelConsumedMap.get(String(obj.job_number)) || 0;
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

        // Fallback for temporarily assigned (global) technicians: the job lives in a
        // different workshop so tenantQuery misses it. Search cross-workshop but only
        // where this technician is actually assigned — no privilege escalation.
        if (!job && req.session?.user?.type === 'technician') {
            job = await Job.findOne({
                job_number: req.params.jobNumber,
                'technicians.technician_id': String(technicianId)
            });
            if (!job && mongoose.Types.ObjectId.isValid(String(req.params.jobNumber))) {
                job = await Job.findOne({
                    _id: req.params.jobNumber,
                    'technicians.technician_id': String(technicianId)
                });
            }
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

// Classify an entry into one of five buckets without trusting the stored
// time_category field (which defaults to 'productive' for legacy records).
function classifyJobEntry(entry) {
    if (entry.is_leave || ['Leave', 'Sick'].includes(entry.category)) return 'not_available';
    if (entry.category === 'Training') return 'training';
    if (['Admin', 'Waiting for Parts'].includes(entry.category)) return 'non_productive';
    if (entry.hour_category === 'utilization_loss') return entry.is_idle ? 'idle' : 'non_productive';
    if (!entry.is_idle && entry.job_id) return 'productive';
    return 'idle'; // Idle, Housekeeping (legacy), Site Work, Travelling, uncategorised
}

async function aggregateCompletedJobsReport(jobs, supervisorKey) {
    const jobNumbers = Array.isArray(jobs)
        ? jobs.map((j) => String(j?.job_number || '')).filter(Boolean)
        : [];
    if (!jobNumbers.length) return [];

    const [timeLogs, reports] = await Promise.all([
        TimeLog.find({
            ...tenantQuery(supervisorKey),
            job_id: { $in: jobNumbers }
        }).lean(),
        JobReport.find({
            ...tenantQuery(supervisorKey),
            job_id: { $in: jobNumbers }
        }).lean()
    ]);

    const technicianIds = new Set();
    jobs.forEach((jobDoc) => {
        const job = jobDoc.toObject ? jobDoc.toObject() : jobDoc;
        (job.technicians || []).forEach((tech) => {
            if (tech?.technician_id) technicianIds.add(String(tech.technician_id));
        });
        (job.subtasks || []).forEach((st) => {
            (st.assigned_technicians || []).forEach((a) => {
                if (a?.technician_id) technicianIds.add(String(a.technician_id));
            });
        });
    });
    timeLogs.forEach((log) => {
        if (log?.technician_id) technicianIds.add(String(log.technician_id));
    });
    reports.forEach((report) => {
        if (report?.technician_id) technicianIds.add(String(report.technician_id));
    });

    const technicianLookup = {};
    if (technicianIds.size) {
        const technicians = await Technician.find({
            ...tenantQuery(supervisorKey),
            _id: { $in: Array.from(technicianIds) }
        }).select({ _id: 1, name: 1 }).lean();
        technicians.forEach((tech) => {
            if (tech?._id) technicianLookup[String(tech._id)] = tech.name;
        });
    }

    const logsByJob = timeLogs.reduce((acc, log) => {
        if (!log || !log.job_id) return acc;
        if (!acc.has(log.job_id)) acc.set(log.job_id, []);
        acc.get(log.job_id).push(log);
        return acc;
    }, new Map());

    const reportsByJob = reports.reduce((acc, report) => {
        if (!report || !report.job_id) return acc;
        if (!acc.has(report.job_id)) acc.set(report.job_id, []);
        acc.get(report.job_id).push(report);
        return acc;
    }, new Map());

    return jobs.map((jobDoc) => {
        const job = jobDoc.toObject ? jobDoc.toObject() : jobDoc;
        const entries = logsByJob.get(String(job.job_number)) || [];
        const jobReports = reportsByJob.get(String(job.job_number)) || [];

        const summary = {
            total_hours: 0,
            productive_hours: 0,
            training_hours: 0,
            non_productive_hours: 0,
            idle_hours: 0,
            not_available_hours: 0,
            entries_count: entries.length
        };

        const hoursByTechnician = {};

        // Derive first/last log dates from actual entries
        const logDates = entries.map(e => e.log_date).filter(Boolean).map(d => new Date(d));
        const firstLogDate = logDates.length ? new Date(Math.min(...logDates.map(d => d.getTime()))) : null;
        const lastLogDate  = logDates.length ? new Date(Math.max(...logDates.map(d => d.getTime()))) : null;

        const timeEntries = entries
            .slice()
            .sort((a, b) => new Date(a.log_date) - new Date(b.log_date))
            .map((entry) => {
                const hrs    = Number(entry.hours_logged || 0);
                const bucket = classifyJobEntry(entry);
                const techId   = String(entry.technician_id || '');
                const techName = techId ? technicianLookup[techId] || null : null;

                // Per-technician accumulation
                if (techId) {
                    if (!hoursByTechnician[techId]) {
                        hoursByTechnician[techId] = {
                            technician_id: techId,
                            technician_name: techName,
                            total_hours: 0,
                            productive_hours: 0,
                            training_hours: 0,
                            non_productive_hours: 0,
                            idle_hours: 0,
                        };
                    }
                    const ts = hoursByTechnician[techId];
                    ts.total_hours += hrs;
                    if (bucket === 'productive')     ts.productive_hours     += hrs;
                    else if (bucket === 'training')  ts.training_hours       += hrs;
                    else if (bucket === 'non_productive') ts.non_productive_hours += hrs;
                    else if (bucket === 'idle')      ts.idle_hours           += hrs;
                }

                // Team summary accumulation
                summary.total_hours += hrs;
                if (bucket === 'productive')          summary.productive_hours     += hrs;
                else if (bucket === 'training')       summary.training_hours       += hrs;
                else if (bucket === 'non_productive') summary.non_productive_hours += hrs;
                else if (bucket === 'idle')           summary.idle_hours           += hrs;
                else if (bucket === 'not_available')  summary.not_available_hours  += hrs;

                return {
                    date: entry.log_date,
                    technician_id: techId || null,
                    technician_name: techName,
                    classification: bucket,
                    category: entry.category || null,
                    sub_reason: entry.category_detail ? String(entry.category_detail).trim() || null : null,
                    job_id: entry.job_id || null,
                    hours: hrs,
                    notes: entry.notes || null,
                };
            });

        return {
            job_number: job.job_number,
            description: job.description,
            supervisor_key: job.supervisor_key,
            status: job.status,
            allocated_hours: job.allocated_hours,
            remaining_hours: job.remaining_hours,
            start_date: job.start_date || firstLogDate,
            end_date: job.actual_completion_date || lastLogDate,
            first_log_date: firstLogDate,
            last_log_date: lastLogDate,
            completed_at: job.actual_completion_date || job.updatedAt || null,
            technicians: job.technicians || [],
            time_summary: summary,
            hours_by_technician: Object.values(hoursByTechnician),
            time_entries: timeEntries,
            job_reports: jobReports.map((report) => ({
                date: report.date,
                technician_id: report.technician_id ? String(report.technician_id) : null,
                technician_name: report.technician_id ? technicianLookup[String(report.technician_id)] || null : null,
                work_completed: report.work_completed || null,
                has_bottleneck: report.has_bottleneck || false,
                bottleneck_description: report.bottleneck_description || null,
                notes: report.notes || null,
            })),
        };
    });
}

// Get completed jobs report
router.get('/completed-report', requireAuth, async (req, res) => {
    try {
        const filter = {
            ...tenantQuery(req.tenant.supervisor_key),
            status: 'completed'
        };

        if (req.query.fromDate) {
            const from = new Date(req.query.fromDate);
            if (Number.isNaN(from.getTime())) {
                return res.status(400).json({ error: 'Invalid fromDate' });
            }
            filter.actual_completion_date = { ...filter.actual_completion_date, $gte: from };
        }
        if (req.query.toDate) {
            const to = new Date(req.query.toDate);
            if (Number.isNaN(to.getTime())) {
                return res.status(400).json({ error: 'Invalid toDate' });
            }
            to.setHours(23, 59, 59, 999);
            filter.actual_completion_date = { ...filter.actual_completion_date, $lte: to };
        }

        const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
        const jobs = await Job.find(filter).sort({ actual_completion_date: -1, updatedAt: -1 }).limit(limit);
        const enriched = await enrichJobsWithTimeLogProgress(jobs, req.tenant.supervisor_key);
        const report = await aggregateCompletedJobsReport(enriched, req.tenant.supervisor_key);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// Get jobs for a technician - include cross-supervisor globally allocated jobs
router.get('/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const technicianId = req.params.technicianId;

        // Find jobs assigned to this technician from ANY supervisor (cross-workshop support)
        const jobs = await Job.find({
            $or: [
                // Jobs from technician's own supervisor
                {
                    ...tenantQuery(req.tenant.supervisor_key),
                    $or: [
                        { 'technicians.technician_id': technicianId },
                        { 'subtasks.assigned_technicians.technician_id': technicianId }
                    ]
                },
                // Jobs from other supervisors (global/temporary allocations)
                {
                    'technicians.technician_id': technicianId,
                    supervisor_key: { $ne: req.tenant.supervisor_key }
                },
                {
                    'subtasks.assigned_technicians.technician_id': technicianId,
                    supervisor_key: { $ne: req.tenant.supervisor_key }
                }
            ]
        }).sort({ createdAt: -1 }).limit(200);

        // Enrich using all relevant supervisor keys so cross-workshop time logs are included
        const allSupervisorKeys = [...new Set([
            req.tenant.supervisor_key,
            ...jobs.map(j => j.supervisor_key).filter(Boolean)
        ])];
        const enriched = await enrichJobsWithTimeLogProgress(jobs, allSupervisorKeys);
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

        // Reject outright if job_number already exists in this tenant, instead of silently
        // repurposing the request as a technician assignment on the old job (which used to
        // discard the newly submitted description/hours/dates/subtasks with no error shown).
        if (body.job_number) {
            const existingJob = await Job.findOne({
                ...tenantQuery(req.tenant.supervisor_key),
                job_number: body.job_number
            });
            if (existingJob) {
                return res.status(409).json({
                    error: `Job number "${body.job_number}" already exists. Choose a different job number.`
                });
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
                job.status = computeDerivedStatus(job);
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
        const enriched = await enrichJobsWithTimeLogProgress([job], req.tenant.supervisor_key);
        res.json(enriched[0]);
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

// Delete job — cascades to TimeLogs and JobReports to prevent orphan records.
router.delete('/:id', requireSupervisor, async (req, res) => {
    try {
        const job = await Job.findOne({
            ...tenantQuery(req.tenant.supervisor_key),
            _id: req.params.id
        });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const jobNumber = job.job_number;

        // Cascade: remove all time entries and job reports linked to this job.
        // This prevents orphan records from inflating KPI calculations.
        await Promise.all([
            TimeLog.deleteMany({ supervisor_key: req.tenant.supervisor_key, job_id: jobNumber }),
            JobReport.deleteMany({ supervisor_key: req.tenant.supervisor_key, job_id: jobNumber })
        ]);

        await Job.deleteOne({ ...tenantQuery(req.tenant.supervisor_key), _id: req.params.id });
        res.json({ message: 'Job deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;