const express = require('express');
const router = express.Router();
const TimeLog = require('../models/TimeLog');
const Technician = require('../models/Technician');
const Job = require('../models/Job');
const TemporaryAssignment = require('../models/TemporaryAssignment');
const { requireAuth, requireSupervisor, tenantQuery } = require('../middleware/auth');

// Create time entry with temporary assignment context
router.post('/', requireAuth, async (req, res) => {
    try {
        const { 
            technician_id, 
            job_id, 
            subtask_id, 
            hours_logged, 
            log_date,
            category,
            category_detail,
            is_idle,
            temporary_assignment_id 
        } = req.body;

        // Validate required fields
        if (!technician_id || !job_id || !hours_logged || !log_date) {
            return res.status(400).json({ 
                error: 'Missing required fields: technician_id, job_id, hours_logged, log_date' 
            });
        }

        // Check if technician has active temporary assignment
        let temporaryAssignment = null;
        if (temporary_assignment_id) {
            temporaryAssignment = await TemporaryAssignment.findById(temporary_assignment_id);
            if (!temporaryAssignment || temporaryAssignment.status !== 'active') {
                return res.status(400).json({ error: 'Invalid temporary assignment' });
            }
        }

        // Get technician details
        const technician = await Technician.findById(technician_id);
        if (!technician) {
            return res.status(404).json({ error: 'Technician not found' });
        }

        // Determine supervisor context
        const supervisorKey = temporaryAssignment 
            ? temporaryAssignment.temporary_supervisor_key 
            : req.tenant.supervisor_key;

        // Create time entry with assignment context
        const timeEntry = new TimeLog({
            supervisor_key: supervisorKey,
            technician_id,
            job_id,
            subtask_id: subtask_id || null,
            hours_logged: Number(hours_logged),
            log_date: new Date(log_date),
            category: category || null,
            category_detail: category_detail || '',
            is_idle: Boolean(is_idle),
            
            // Temporary assignment context
            temporary_assignment_id: temporary_assignment_id || null,
            is_temporary_assignment: Boolean(temporaryAssignment),
            original_supervisor_key: temporaryAssignment 
                ? temporaryAssignment.original_supervisor_key 
                : req.tenant.supervisor_key,
            
            // Default approval status
            approval_status: 'approved',
            approved_hours: Number(hours_logged),
            approved_by: req.session.user?.email || null,
            approved_at: new Date()
        });

        await timeEntry.save();

        // Update temporary assignment with hours logged
        if (temporaryAssignment) {
            await TemporaryAssignment.findByIdAndUpdate(temporary_assignment_id, {
                $inc: { total_hours_logged: Number(hours_logged) }
            });
        }

        res.status(201).json({
            message: 'Time entry created successfully',
            timeEntry: {
                ...timeEntry.toObject(),
                isTemporaryAssignment: Boolean(temporaryAssignment),
                assignmentContext: temporaryAssignment ? {
                    id: temporaryAssignment._id,
                    originalSupervisor: temporaryAssignment.original_supervisor_key,
                    temporarySupervisor: temporaryAssignment.temporary_supervisor_key,
                    reason: temporaryAssignment.reason,
                    expiresAt: temporaryAssignment.expires_at
                } : null
            }
        });

    } catch (error) {
        console.error('Time entry creation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get time entries with assignment context
router.get('/', requireAuth, async (req, res) => {
    try {
        const { technician_id, start_date, end_date, include_temporary } = req.query;
        
        const query = { supervisor_key: req.tenant.supervisor_key };
        
        if (technician_id) {
            query.technician_id = technician_id;
        }
        
        if (start_date || end_date) {
            query.log_date = {};
            if (start_date) {
                query.log_date.$gte = new Date(start_date);
            }
            if (end_date) {
                query.log_date.$lte = new Date(end_date);
            }
        }

        // Include temporary assignments if requested
        if (include_temporary === 'true') {
            query.$or = [
                { supervisor_key: req.tenant.supervisor_key },
                { is_temporary_assignment: true }
            ];
        }

        const timeEntries = await TimeLog.find(query)
            .populate('temporary_assignment_id', 'reason original_supervisor_key temporary_supervisor_key')
            .populate('technician_id', 'name employee_id employeeNumber')
            .sort({ log_date: -1, createdAt: -1 });

        res.json(timeEntries);
    } catch (error) {
        console.error('Get time entries error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get performance summary for temporary assignments
router.get('/temporary-assignment-performance/:assignmentId', requireSupervisor, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        
        const assignment = await TemporaryAssignment.findById(assignmentId)
            .populate('technician_id', 'name employee_id employeeNumber');

        if (!assignment || assignment.temporary_supervisor_key !== req.tenant.supervisor_key) {
            return res.status(404).json({ error: 'Temporary assignment not found' });
        }

        // Get all time entries for this assignment
        const timeEntries = await TimeLog.find({
            temporary_assignment_id: assignmentId
        }).sort({ log_date: -1 });

        // Calculate performance metrics
        const totalHours = timeEntries.reduce((sum, entry) => sum + Number(entry.hours_logged || 0), 0);
        const productiveHours = timeEntries
            .filter(entry => !entry.is_idle)
            .reduce((sum, entry) => sum + Number(entry.hours_logged || 0), 0);
        const jobsWorked = new Set(timeEntries.map(entry => entry.job_id)).size;

        const performance = {
            assignment: {
                ...assignment.toObject(),
                technician: assignment.technician_id
            },
            metrics: {
                totalHoursLogged: totalHours,
                productiveHours: productiveHours,
                utilizationRate: totalHours > 0 ? (productiveHours / totalHours) * 100 : 0,
                jobsWorked: jobsWorked,
                averageHoursPerJob: jobsWorked > 0 ? totalHours / jobsWorked : 0,
                timeEntries: timeEntries.map(entry => ({
                    date: entry.log_date,
                    jobId: entry.job_id,
                    hours: entry.hours_logged,
                    isProductive: !entry.is_idle,
                    category: entry.category
                }))
            }
        };

        res.json(performance);
    } catch (error) {
        console.error('Get temporary assignment performance error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
