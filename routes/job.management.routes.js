const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const JobManagementService = require('../services/jobManagementService');
const { requireAuth } = require('../middleware/auth');

/**
 * Job Management Routes - Phase 3
 * Handles job status tracking, risk assessment, and capacity validation
 */

// Get all active jobs for supervisor
router.get('/:supervisorKey/active', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { complexity } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            status: { $in: ['active', 'in_progress'] }
        };

        if (complexity) {
            query.complexity_category = complexity;
        }

        const jobs = await Job.find(query)
            .populate('technicians.technician_id', 'name employee_id')
            .sort({ target_completion_date: 1 });

        // Enrich with risk assessment
        const jobsWithRisk = await Promise.all(
            jobs.map(async (job) => {
                const risk = await JobManagementService.calculateJobRisk(job._id);
                return {
                    ...job.toObject(),
                    risk_assessment: risk
                };
            })
        );

        res.json({
            success: true,
            data: jobsWithRisk,
            count: jobsWithRisk.length,
            summary: {
                total_active: jobsWithRisk.length,
                at_risk_count: jobsWithRisk.filter(j => j.risk_assessment.risk_level !== 'GREEN').length,
                critical_count: jobsWithRisk.filter(j => j.risk_assessment.risk_level === 'RED').length
            }
        });
    } catch (error) {
        console.error('Error fetching active jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all completed jobs
router.get('/:supervisorKey/completed', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const completedJobs = await JobManagementService.getCompletedJobs(
            supervisorKey,
            start_date,
            end_date
        );

        res.json({
            success: true,
            data: completedJobs,
            count: completedJobs.length
        });
    } catch (error) {
        console.error('Error fetching completed jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get jobs at risk
router.get('/:supervisorKey/at-risk', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { risk_level } = req.query; // 'GREEN', 'ORANGE', 'RED'

        const atRiskJobs = await JobManagementService.getJobsAtRisk(
            supervisorKey,
            risk_level
        );

        // Group by risk level
        const grouped = {
            RED: atRiskJobs.filter(j => j.risk_assessment.risk_level === 'RED'),
            ORANGE: atRiskJobs.filter(j => j.risk_assessment.risk_level === 'ORANGE'),
            GREEN: atRiskJobs.filter(j => j.risk_assessment.risk_level === 'GREEN')
        };

        res.json({
            success: true,
            data: atRiskJobs,
            grouped_by_risk: grouped,
            summary: {
                total_at_risk: atRiskJobs.length,
                red_count: grouped.RED.length,
                orange_count: grouped.ORANGE.length,
                green_count: grouped.GREEN.length
            }
        });
    } catch (error) {
        console.error('Error fetching jobs at risk:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get risk assessment for specific job
router.get('/:supervisorKey/job/:jobId/risk', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;

        const job = await Job.findById(jobId);
        if (!job || job.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const riskAssessment = await JobManagementService.calculateJobRisk(jobId);

        res.json({
            success: true,
            data: riskAssessment
        });
    } catch (error) {
        console.error('Error calculating job risk:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get technician's active jobs
router.get('/:supervisorKey/technician/:technicianId/active', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;

        const techJobs = await JobManagementService.getTechnicianActiveJobs(
            supervisorKey,
            technicianId
        );

        res.json({
            success: true,
            data: techJobs,
            count: techJobs.length
        });
    } catch (error) {
        console.error('Error fetching technician active jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Validate job capacity before assignment
router.post('/:supervisorKey/validate-capacity', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { job_id, technician_ids } = req.body;

        if (!job_id || !technician_ids || technician_ids.length === 0) {
            return res.status(400).json({ error: 'Missing job_id or technician_ids' });
        }

        const validation = await JobManagementService.validateJobCapacity(
            supervisorKey,
            job_id,
            technician_ids
        );

        res.json({
            success: true,
            data: validation
        });
    } catch (error) {
        console.error('Error validating job capacity:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update job status
router.post('/:supervisorKey/job/:jobId/status', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;
        const { status, reason } = req.body;

        const validStatuses = ['pending_confirmation', 'active', 'in_progress', 'completed', 'at_risk', 'over_allocated', 'overrun'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const job = await Job.findById(jobId);
        if (!job || job.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const oldStatus = job.status;
        job.status = status;

        // Add to audit history
        if (!job.audit_history) {
            job.audit_history = [];
        }
        job.audit_history.push({
            timestamp: new Date(),
            from_status: oldStatus,
            to_status: status,
            reason: reason || 'Status update',
            changed_by: req.user?.id || 'system'
        });

        if (status === 'completed') {
            job.actual_completion_date = new Date();
        }

        await job.save();

        res.json({
            success: true,
            data: job,
            message: `Job status updated from ${oldStatus} to ${status}`
        });
    } catch (error) {
        console.error('Error updating job status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get complexity distribution
router.get('/:supervisorKey/complexity-distribution', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;

        const distribution = await JobManagementService.getComplexityDistribution(supervisorKey);

        res.json({
            success: true,
            data: distribution
        });
    } catch (error) {
        console.error('Error getting complexity distribution:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get job report (detailed)
router.get('/:supervisorKey/job/:jobId/report', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;

        const job = await Job.findById(jobId)
            .populate('technicians.technician_id', 'name employee_id')
            .lean();

        if (!job || job.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Job not found' });
        }

        // Calculate metrics
        const efficiency = job.allocated_hours > 0
            ? ((job.consumed_hours / job.allocated_hours) * 100).toFixed(2)
            : 0;

        const remaining = Math.max(0, job.allocated_hours - job.consumed_hours);

        // Get technician time breakdown
        const technicianBreakdown = job.technicians.map(tech => ({
            technician_id: tech.technician_id._id,
            technician_name: tech.technician_id.name,
            allocated_hours: tech.allocated_hours,
            consumed_hours: tech.consumed_hours,
            remaining_hours: Math.max(0, tech.allocated_hours - tech.consumed_hours)
        }));

        res.json({
            success: true,
            data: {
                job_id: job._id,
                job_number: job.job_number,
                description: job.description,
                complexity_category: job.complexity_category,
                status: job.status,
                start_date: job.start_date,
                target_completion_date: job.target_completion_date,
                actual_completion_date: job.actual_completion_date,
                
                hours: {
                    allocated: job.allocated_hours,
                    consumed: job.consumed_hours,
                    remaining: remaining,
                    efficiency_percent: efficiency,
                    overrun: job.consumed_hours > job.allocated_hours ? job.consumed_hours - job.allocated_hours : 0
                },
                
                technicians: technicianBreakdown,
                
                progress: {
                    percentage: job.progress_percentage,
                    subtasks_total: job.subtasks?.length || 0,
                    subtasks_completed: job.subtasks?.filter(s => s.progress_by_technician?.some(p => p.completed))?.length || 0
                }
            }
        });
    } catch (error) {
        console.error('Error generating job report:', error);
        res.status(500).json({ error: error.message });
    }
});

// Bulk update job status (for multiple jobs)
router.post('/:supervisorKey/bulk-status-update', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { job_ids, status, reason } = req.body;

        if (!job_ids || job_ids.length === 0 || !status) {
            return res.status(400).json({ error: 'Missing job_ids or status' });
        }

        const results = {
            success: [],
            failed: []
        };

        for (const jobId of job_ids) {
            try {
                const job = await Job.findById(jobId);
                if (!job || job.supervisor_key !== supervisorKey) {
                    results.failed.push({ job_id: jobId, error: 'Not found' });
                    continue;
                }

                const oldStatus = job.status;
                job.status = status;

                if (!job.audit_history) {
                    job.audit_history = [];
                }
                job.audit_history.push({
                    timestamp: new Date(),
                    from_status: oldStatus,
                    to_status: status,
                    reason: reason || 'Bulk update',
                    changed_by: req.user?.id || 'system'
                });

                if (status === 'completed') {
                    job.actual_completion_date = new Date();
                }

                await job.save();
                results.success.push(jobId);
            } catch (error) {
                results.failed.push({ job_id: jobId, error: error.message });
            }
        }

        res.json({
            success: true,
            data: results,
            summary: {
                total_requested: job_ids.length,
                successful: results.success.length,
                failed: results.failed.length
            }
        });
    } catch (error) {
        console.error('Error bulk updating job statuses:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
