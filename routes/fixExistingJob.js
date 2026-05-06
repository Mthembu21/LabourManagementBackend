const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const { requireAuth } = require('../middleware/auth');

// Fix existing cross-supervisor job assignment
router.post('/fix-existing-job', requireAuth, async (req, res) => {
    try {
        const { jobNumber, technicianId, technicianName, newSupervisorKey } = req.body;
        
        console.log('Fixing existing job assignment:', {
            jobNumber,
            technicianId,
            technicianName,
            newSupervisorKey
        });
        
        // Find the job
        const job = await Job.findOne({ job_number: jobNumber });
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        
        // Find the technician
        const technician = await require('../models/Technician').findOne({ 
            technician_id: technicianId 
        });
        if (!technician) {
            return res.status(404).json({ error: 'Technician not found' });
        }
        
        console.log(`Current job supervisor: ${job.supervisor_key}`);
        console.log(`Technician supervisor: ${technician.supervisor_key}`);
        
        // Check if this is a cross-supervisor assignment issue
        if (job.supervisor_key !== technician.supervisor_key) {
            console.log('✅ Cross-supervisor assignment detected - fixing...');
            
            // Update job to be visible to technician
            job.technicians.push({
                technician_id: technicianId,
                technician_name: technicianName,
                confirmed_by_technician: false,
                confirmed_date: null,
                consumed_hours: 0,
                supervisor_key: technician.supervisor_key, // Update to technician's supervisor
                assigned_at: new Date()
            });
            
            // Remove any old assignments from different supervisors
            job.technicians = job.technicians.filter(tech => 
                tech.technician_id !== technicianId || 
                tech.supervisor_key !== technician.supervisor_key
            );
            
            await job.save();
            
            console.log('✅ Job fixed and should now be visible to technician');
            
            res.json({
                message: 'Job assignment fixed',
                job: {
                    job_number: job.job_number,
                    supervisor_key: job.supervisor_key,
                    technician_assignments: job.technicians
                }
            });
        } else {
            console.log('❌ No cross-supervisor issue detected');
            res.json({
                message: 'No cross-supervisor assignment issue found'
            });
        }
        
    } catch (error) {
        console.error('Error fixing existing job:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
