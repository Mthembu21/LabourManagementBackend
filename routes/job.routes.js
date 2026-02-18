const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const Technician = require('../models/Technician');
const { requireAuth, requireSupervisor } = require('../middleware/auth');

function calculateAggregatedProgress(jobDoc) {
    const job = jobDoc?.toObject ? jobDoc.toObject() : jobDoc;
    const subtasks = job?.subtasks || [];

    const totals = {
        overall: 0,
        byTechnician: {}
    };

    if (!subtasks.length) {
        totals.overall = job?.progress_percentage || 0;

        const allocated = Number(job?.allocated_hours || 0) || 0;
        const assignments = job?.technicians || [];
        if (allocated > 0 && assignments.length) {
            for (const t of assignments) {
                const techId = t?.technician_id?.toString?.() || String(t?.technician_id || '');
                if (!techId) continue;
                const consumed = Number(t?.consumed_hours || 0) || 0;
                totals.byTechnician[techId] = Math.max(0, Math.min(100, (consumed / allocated) * 100));
            }
        }
        return totals;
    }

    const totalWeight = subtasks.reduce((sum, st) => sum + (typeof st.weight === 'number' ? st.weight : 1), 0) || 1;

    const subtaskAggregated = subtasks.map((st) => {
        const entries = st.progress_by_technician || [];
        const summed = entries.reduce((s, e) => s + (e.progress_percentage || 0), 0);
        return {
            id: st._id?.toString?.() || st.id,
            weight: typeof st.weight === 'number' ? st.weight : 1,
            aggregated: Math.max(0, Math.min(100, summed)),
            entries
        };
    });

    totals.overall = subtaskAggregated.reduce((sum, st) => sum + (st.aggregated * st.weight), 0) / totalWeight;

    const techIds = new Set();
    for (const st of subtaskAggregated) {
        for (const e of st.entries || []) {
            if (e.technician_id) techIds.add(e.technician_id.toString());
        }
    }

    for (const techId of techIds) {
        const weighted = subtaskAggregated.reduce((sum, st) => {
            const match = (st.entries || []).find((e) => e.technician_id && e.technician_id.toString() === techId);
            return sum + ((match?.progress_percentage || 0) * st.weight);
        }, 0);
        totals.byTechnician[techId] = weighted / totalWeight;
    }

    return totals;
}

// Confirm/accept a job assignment for a technician (by Job ID)
router.put('/by-job/:jobNumber/confirm', requireAuth, async (req, res) => {
    try {
        const technicianId = req.body?.technician_id || req.session?.user?.id;
        if (!technicianId) return res.status(400).json({ error: 'technician_id is required' });

        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const tech = (job.technicians || []).find((t) => t.technician_id && t.technician_id.toString() === String(technicianId));
        if (!tech) return res.status(404).json({ error: 'Technician is not assigned to this job' });

        tech.confirmed_by_technician = true;
        tech.confirmed_date = new Date();

        if (job.status === 'pending_confirmation') {
            job.status = 'active';
        }

        await job.save();

        const agg = calculateAggregatedProgress(job);
        const obj = job.toObject();
        const firstTech = (obj.technicians || [])[0];
        res.json({
            ...obj,
            assigned_technician_id: firstTech?.technician_id,
            assigned_technician_name: firstTech?.technician_name,
            aggregated_progress_percentage: agg.overall,
            progress_by_technician: agg.byTechnician
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
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

        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        if (!technicianName) {
            const tech = await Technician.findById(technicianId);
            if (!tech) return res.status(400).json({ error: 'Technician not found' });
            technicianName = tech.name;
        }

        const existing = (job.technicians || []).find(
            (t) => t.technician_id && t.technician_id.toString() === String(technicianId)
        );

        if (!existing) {
            job.technicians = job.technicians || [];
            job.technicians.push({
                technician_id: technicianId,
                technician_name: technicianName,
                confirmed_by_technician: false,
                confirmed_date: null,
                consumed_hours: 0
            });
        } else if (technicianName && !existing.technician_name) {
            existing.technician_name = technicianName;
        }

        // Do not block other technicians by resetting an already-active job back to pending_confirmation
        if (!job.status) {
            job.status = 'pending_confirmation';
        }

        await job.save();

        const agg = calculateAggregatedProgress(job);
        const obj = job.toObject();
        const firstTech = (obj.technicians || [])[0];
        res.json({
            ...obj,
            assigned_technician_id: firstTech?.technician_id,
            assigned_technician_name: firstTech?.technician_name,
            aggregated_progress_percentage: agg.overall,
            progress_by_technician: agg.byTechnician
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get all jobs
router.get('/', requireAuth, async (req, res) => {
    try {
        const jobs = await Job.find().sort({ createdAt: -1 }).limit(200);
        const enriched = jobs.map((j) => {
            const agg = calculateAggregatedProgress(j);
            const obj = j.toObject();
            const firstTech = (obj.technicians || [])[0];
            return {
                ...obj,
                assigned_technician_id: firstTech?.technician_id,
                assigned_technician_name: firstTech?.technician_name,
                aggregated_progress_percentage: agg.overall,
                progress_by_technician: agg.byTechnician
            };
        });
        res.json(enriched);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get jobs for a technician
router.get('/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const jobs = await Job.find({ 'technicians.technician_id': req.params.technicianId }).sort({ createdAt: -1 }).limit(200);
        const enriched = jobs.map((j) => {
            const agg = calculateAggregatedProgress(j);
            const obj = j.toObject();
            const firstTech = (obj.technicians || [])[0];
            return {
                ...obj,
                assigned_technician_id: firstTech?.technician_id,
                assigned_technician_name: firstTech?.technician_name,
                aggregated_progress_percentage: agg.overall,
                progress_by_technician: agg.byTechnician
            };
        });
        res.json(enriched);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a job by Job ID (job_number)
router.get('/by-job/:jobNumber', requireAuth, async (req, res) => {
    try {
        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const agg = calculateAggregatedProgress(job);
        const obj = job.toObject();
        const firstTech = (obj.technicians || [])[0];
        res.json({
            ...obj,
            assigned_technician_id: firstTech?.technician_id,
            assigned_technician_name: firstTech?.technician_name,
            aggregated_progress_percentage: agg.overall,
            progress_by_technician: agg.byTechnician
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create job
router.post('/', requireSupervisor, async (req, res) => {
    try {
        const body = req.body || {};
        const technicians = Array.isArray(body.technicians) ? body.technicians : [];

        // If job_number already exists, treat this as "assign another technician" instead of creating a new job
        if (body.job_number) {
            const existingJob = await Job.findOne({ job_number: body.job_number });
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

                const alreadyAssigned = (existingJob.technicians || []).some(
                    (t) => t.technician_id && t.technician_id.toString() === String(technicianId)
                );

                if (!alreadyAssigned) {
                    existingJob.technicians = existingJob.technicians || [];
                    existingJob.technicians.push({
                        technician_id: technicianId,
                        technician_name: technicianName,
                        confirmed_by_technician: false,
                        confirmed_date: null,
                        consumed_hours: 0
                    });
                }

                // Do not block other technicians by resetting an already-active job back to pending_confirmation
                if (!existingJob.status) {
                    existingJob.status = 'pending_confirmation';
                }
                await existingJob.save();

                const agg = calculateAggregatedProgress(existingJob);
                const obj = existingJob.toObject();
                const firstTech = (obj.technicians || [])[0];
                return res.json({
                    ...obj,
                    assigned_technician_id: firstTech?.technician_id,
                    assigned_technician_name: firstTech?.technician_name,
                    aggregated_progress_percentage: agg.overall,
                    progress_by_technician: agg.byTechnician
                });
            }
        }

        if (!technicians.length && body.assigned_technician_id) {
            technicians.push({
                technician_id: body.assigned_technician_id,
                technician_name: body.assigned_technician_name || ''
            });
        }

        const jobData = {
            ...body,
            technicians,
            remaining_hours: body.allocated_hours
        };

        const job = new Job(jobData);
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ error: 'Job number already exists' });
        }
        res.status(400).json({ error: error.message });
    }
});

// Update a job by Job ID (job_number)
router.put('/by-job/:jobNumber', requireAuth, async (req, res) => {
    try {
        const job = await Job.findOneAndUpdate(
            { job_number: req.params.jobNumber },
            req.body,
            { new: true, runValidators: true }
        );
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const agg = calculateAggregatedProgress(job);
        const obj = job.toObject();
        const firstTech = (obj.technicians || [])[0];
        res.json({
            ...obj,
            assigned_technician_id: firstTech?.technician_id,
            assigned_technician_name: firstTech?.technician_name,
            aggregated_progress_percentage: agg.overall,
            progress_by_technician: agg.byTechnician
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update job (legacy endpoint, supports old fields)
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
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

        const agg = calculateAggregatedProgress(job);
        const obj = job.toObject();
        const firstTech = (obj.technicians || [])[0];
        res.json({
            ...obj,
            assigned_technician_id: firstTech?.technician_id,
            assigned_technician_name: firstTech?.technician_name,
            aggregated_progress_percentage: agg.overall,
            progress_by_technician: agg.byTechnician
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/by-job/:jobNumber/subtasks', requireAuth, async (req, res) => {
    try {
        const { title, weight } = req.body || {};
        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        job.subtasks.push({
            title,
            weight: typeof weight === 'number' ? weight : 1,
            progress_by_technician: []
        });
        await job.save();
        res.status(201).json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.put('/by-job/:jobNumber/subtasks/:subtaskId', requireAuth, async (req, res) => {
    try {
        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });
        const st = job.subtasks.id(req.params.subtaskId);
        if (!st) return res.status(404).json({ error: 'Subtask not found' });

        if (typeof req.body.title === 'string') st.title = req.body.title;
        if (typeof req.body.weight === 'number') st.weight = req.body.weight;
        await job.save();
        res.json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/by-job/:jobNumber/subtasks/:subtaskId', requireAuth, async (req, res) => {
    try {
        const job = await Job.findOne({ job_number: req.params.jobNumber });
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
        const { technician_id, progress_percentage } = req.body || {};
        const job = await Job.findOne({ job_number: req.params.jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const st = job.subtasks.id(req.params.subtaskId);
        if (!st) return res.status(404).json({ error: 'Subtask not found' });

        const pct = Math.max(0, Math.min(100, Number(progress_percentage)));
        const existing = (st.progress_by_technician || []).find((p) => p.technician_id && p.technician_id.toString() === technician_id);
        if (existing) {
            existing.progress_percentage = pct;
            existing.updated_at = new Date();
        } else {
            st.progress_by_technician.push({ technician_id, progress_percentage: pct, updated_at: new Date() });
        }

        const agg = calculateAggregatedProgress(job);
        job.progress_percentage = agg.overall;
        await job.save();

        const obj = job.toObject();
        res.json({
            ...obj,
            aggregated_progress_percentage: agg.overall,
            progress_by_technician: agg.byTechnician
        });
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