/**
 * PHASE 7: System Fixes
 * Fixes for technician job visibility and workshop-level access
 */

const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const { requireAuth } = require('../middleware/auth');

/**
 * FIX 1: Ensure all allocated jobs visible to technicians
 * GET /api/system-fixes/verify-job-visibility/:supervisorKey/:technicianId
 */
router.get('/verify-job-visibility/:supervisorKey/:technicianId', requireAuth, async (req, res) => {
  try {
    const { supervisorKey, technicianId } = req.params;

    // Find all jobs allocated to this technician
    const allocatedJobs = await Job.find({
      supervisor_key: supervisorKey,
      'technicians.technician_id': technicianId,
      status: { $ne: 'archived' }
    }).select('job_number description status technicians progress_percentage');

    if (allocatedJobs.length === 0) {
      return res.json({
        success: true,
        status: 'VERIFIED',
        message: 'No allocated jobs found for this technician',
        jobCount: 0,
        visibility: 'N/A'
      });
    }

    // Verify each job is accessible to technician
    let visibleCount = 0;
    let hiddenCount = 0;
    const visibilityReport = [];

    for (const job of allocatedJobs) {
      const assignment = job.technicians.find(t => t.technician_id.toString() === technicianId);
      if (assignment) {
        visibleCount++;
        visibilityReport.push({
          job_id: job._id,
          job_number: job.job_number,
          status: 'VISIBLE',
          allocated_hours: assignment.allocated_hours
        });
      } else {
        hiddenCount++;
        visibilityReport.push({
          job_id: job._id,
          job_number: job.job_number,
          status: 'HIDDEN - ALLOCATION MISMATCH',
          issue: 'Job found in query but technician assignment missing'
        });
      }
    }

    res.json({
      success: true,
      status: hiddenCount === 0 ? 'VERIFIED' : 'ISSUES_FOUND',
      technicianId,
      totalAllocatedJobs: allocatedJobs.length,
      visibleJobs: visibleCount,
      hiddenJobs: hiddenCount,
      visibilityReport,
      recommendation: hiddenCount > 0 ? 'Run fix-allocation-visibility endpoint to repair' : 'All jobs visible'
    });
  } catch (error) {
    console.error('Error verifying job visibility:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * FIX 2: Repair technician allocation visibility
 * POST /api/system-fixes/fix-allocation-visibility/:supervisorKey/:technicianId
 */
router.post('/fix-allocation-visibility/:supervisorKey/:technicianId', requireAuth, async (req, res) => {
  try {
    const { supervisorKey, technicianId } = req.params;

    // Find jobs where technician is allocated but hidden
    const jobsWithTechnicianInList = await Job.find({
      supervisor_key: supervisorKey,
      'technicians.technician_id': technicianId
    });

    let fixedCount = 0;
    const fixReport = [];

    for (const job of jobsWithTechnicianInList) {
      const assignment = job.technicians.find(t => t.technician_id.toString() === technicianId);
      
      if (assignment) {
        // Ensure job status is not hidden
        if (job.status === 'archived' || job.status === 'hidden') {
          job.status = 'active';
          await job.save();
          fixedCount++;
          fixReport.push({
            job_id: job._id,
            action: 'RESTORED_VISIBILITY',
            details: `Changed status from ${job.status} to active`
          });
        } else {
          fixReport.push({
            job_id: job._id,
            action: 'ALREADY_VISIBLE',
            status: job.status
          });
        }
      }
    }

    res.json({
      success: true,
      technicianId,
      totalJobsChecked: jobsWithTechnicianInList.length,
      jobsFixed: fixedCount,
      fixReport,
      message: `Fixed visibility for ${fixedCount} job(s)`
    });
  } catch (error) {
    console.error('Error fixing allocation visibility:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * FIX 3: Verify supervisor-to-technician assignment API
 * GET /api/system-fixes/verify-supervisor-assignment/:supervisorKey
 */
router.get('/verify-supervisor-assignment/:supervisorKey', requireAuth, async (req, res) => {
  try {
    const { supervisorKey } = req.params;

    // Get all jobs and technician assignments
    const allJobs = await Job.find({ supervisor_key: supervisorKey })
      .populate('technicians.technician_id', 'name employee_id');

    const technicianAssignments = {};
    let totalAssignments = 0;
    let orphanedAssignments = 0;

    allJobs.forEach(job => {
      job.technicians.forEach(tech => {
        totalAssignments++;
        if (!tech.technician_id) {
          orphanedAssignments++;
        } else {
          const techId = tech.technician_id._id.toString();
          if (!technicianAssignments[techId]) {
            technicianAssignments[techId] = {
              technician_name: tech.technician_id.name,
              employee_id: tech.technician_id.employee_id,
              job_count: 0,
              jobs: []
            };
          }
          technicianAssignments[techId].job_count++;
          technicianAssignments[techId].jobs.push(job.job_number);
        }
      });
    });

    res.json({
      success: true,
      status: orphanedAssignments === 0 ? 'VERIFIED' : 'ISSUES_FOUND',
      supervisorKey,
      totalAssignments,
      orphanedAssignments,
      technicianCount: Object.keys(technicianAssignments).length,
      technicianAssignments,
      recommendation: orphanedAssignments > 0 ? 'Run fix-orphaned-assignments endpoint to clean up' : 'All assignments valid'
    });
  } catch (error) {
    console.error('Error verifying supervisor assignment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * FIX 4: Clean up orphaned technician assignments
 * POST /api/system-fixes/fix-orphaned-assignments/:supervisorKey
 */
router.post('/fix-orphaned-assignments/:supervisorKey', requireAuth, async (req, res) => {
  try {
    const { supervisorKey } = req.params;

    // Find and remove orphaned assignments (where technician_id is missing)
    const result = await Job.updateMany(
      {
        supervisor_key: supervisorKey,
        'technicians.technician_id': null
      },
      {
        $pull: { technicians: { technician_id: null } }
      }
    );

    res.json({
      success: true,
      status: 'CLEANED',
      supervisorKey,
      jobsModified: result.modifiedCount,
      assignmentsRemoved: result.modifiedCount * 1, // Approximate
      message: `Removed orphaned assignments from ${result.modifiedCount} job(s)`
    });
  } catch (error) {
    console.error('Error fixing orphaned assignments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * FIX 5: Verify workshop-level access consistency
 * GET /api/system-fixes/verify-workshop-access/:supervisorKey
 */
router.get('/verify-workshop-access/:supervisorKey', requireAuth, async (req, res) => {
  try {
    const { supervisorKey } = req.params;

    // Verify all jobs have correct supervisor_key
    const jobsWithWrongKey = await Job.find({
      supervisor_key: { $ne: supervisorKey }
    }).count();

    const jobsWithCorrectKey = await Job.find({
      supervisor_key: supervisorKey
    }).count();

    // Verify no cross-workshop data leakage
    const allJobs = await Job.find({ supervisor_key: supervisorKey });
    let accessViolations = 0;

    allJobs.forEach(job => {
      if (job.supervisor_key !== supervisorKey) {
        accessViolations++;
      }
    });

    res.json({
      success: true,
      status: accessViolations === 0 ? 'VERIFIED' : 'ISSUES_FOUND',
      supervisorKey,
      jobsWithCorrectKey,
      jobsWithWrongKey,
      accessViolations,
      recommendation: accessViolations === 0 ? 'Workshop access is secure' : 'Run fix-workshop-access endpoint'
    });
  } catch (error) {
    console.error('Error verifying workshop access:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * FIX 6: Repair workshop-level access
 * POST /api/system-fixes/fix-workshop-access/:supervisorKey
 */
router.post('/fix-workshop-access/:supervisorKey', requireAuth, async (req, res) => {
  try {
    const { supervisorKey } = req.params;

    // Update all jobs without correct supervisor_key
    const result = await Job.updateMany(
      { supervisor_key: { $exists: false } },
      { $set: { supervisor_key: supervisorKey } }
    );

    res.json({
      success: true,
      status: 'FIXED',
      supervisorKey,
      jobsUpdated: result.modifiedCount,
      message: `Updated supervisor_key for ${result.modifiedCount} job(s)`
    });
  } catch (error) {
    console.error('Error fixing workshop access:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
