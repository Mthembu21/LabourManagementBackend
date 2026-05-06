const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const Technician = require('../models/Technician');
const { requireAuth, requireSupervisor } = require('../middleware/auth');

// Fix existing cross-supervisor job assignments
router.post('/fix-cross-supervisor-jobs', requireAuth, async (req, res) => {
    try {
        console.log('Starting cross-supervisor job fix...');
        
        // Find all jobs with technicians assigned
        const jobs = await Job.find({
            'technicians.technician_id': { $exists: true }
        });
        
        console.log(`Found ${jobs.length} jobs with technician assignments`);
        
        const crossSupervisorJobs = [];
        
        for (const job of jobs) {
            for (const techAssignment of job.technicians) {
                const technicianId = techAssignment.technician_id;
                
                // Find the technician to get their actual supervisor
                const technician = await Technician.findOne({ 
                    technician_id: technicianId 
                });
                
                if (technician && job.supervisor_key !== technician.supervisor_key) {
                    crossSupervisorJobs.push({
                        job_number: job.job_number,
                        job_id: job._id,
                        technician_id: technicianId,
                        technician_name: technician.name,
                        job_supervisor: job.supervisor_key,
                        technician_supervisor: technician.supervisor_key,
                        status: job.status
                    });
                }
            }
        }
        
        console.log(`Found ${crossSupervisorJobs.length} cross-supervisor job assignments`);
        
        res.json({
            message: 'Cross-supervisor job analysis complete',
            total_jobs_analyzed: jobs.length,
            cross_supervisor_assignments: crossSupervisorJobs.length,
            jobs: crossSupervisorJobs
        });
        
    } catch (error) {
        console.error('Error fixing cross-supervisor jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
