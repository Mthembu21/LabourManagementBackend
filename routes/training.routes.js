const express = require('express');
const router = express.Router();
const TrainingLog = require('../models/TrainingLog');
const DayEntry = require('../models/DayEntry');
const Technician = require('../models/Technician');
const { requireAuth } = require('../middleware/auth');

/**
 * Training Management Routes - Phase 2
 * Handles training log capture and tracking
 */

// Log training session
router.post('/:supervisorKey/log', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { 
            technician_id, 
            training_date, 
            training_title, 
            description,
            training_category,
            hours_spent,
            trainer_name,
            location,
            competency_achieved,
            assessment_score,
            notes 
        } = req.body;

        if (!technician_id || !training_date || !training_title || !hours_spent) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const tech = await Technician.findById(technician_id);
        const dateObj = new Date(training_date);

        const trainingLog = new TrainingLog({
            supervisor_key: supervisorKey,
            technician_id,
            technician_name: tech?.name || 'Unknown',
            training_title,
            description: description || '',
            training_category: training_category || 'Other',
            hours_spent,
            training_date: dateObj,
            trainer_name: trainer_name || null,
            location: location || 'On-site',
            competency_achieved: competency_achieved !== undefined ? competency_achieved : null,
            assessment_score: assessment_score || null,
            notes: notes || '',
            training_status: 'completed'
        });

        await trainingLog.save();

        // Also add to DayEntry as non-productive
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: today
        });

        if (dayEntry) {
            dayEntry.job_entries.push({
                job_id: `training_${trainingLog._id}`,
                job_number: 'Training',
                non_productive_hours: hours_spent,
                notes: `Training: ${training_title}`
            });
            await dayEntry.save();
        }

        res.json({
            success: true,
            data: trainingLog,
            message: `Training logged: ${training_title} (${hours_spent} hours)`
        });
    } catch (error) {
        console.error('Error logging training:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get training logs
router.get('/:supervisorKey/logs', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { technician_id, start_date, end_date, training_status, approval_status } = req.query;

        const query = { supervisor_key: supervisorKey };

        if (technician_id) {
            query.technician_id = technician_id;
        }

        if (start_date || end_date) {
            query.training_date = {};
            if (start_date) {
                query.training_date.$gte = new Date(start_date);
            }
            if (end_date) {
                query.training_date.$lte = new Date(end_date);
            }
        }

        if (training_status) {
            query.training_status = training_status;
        }

        if (approval_status) {
            query.approval_status = approval_status;
        }

        const logs = await TrainingLog.find(query)
            .populate('technician_id', 'name employee_id')
            .sort({ training_date: -1 });

        res.json({
            success: true,
            data: logs,
            count: logs.length
        });
    } catch (error) {
        console.error('Error fetching training logs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get training summary for technician
router.get('/:supervisorKey/summary/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;
        const { start_date, end_date } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            technician_id: technicianId
        };

        if (start_date || end_date) {
            query.training_date = {};
            if (start_date) {
                query.training_date.$gte = new Date(start_date);
            }
            if (end_date) {
                query.training_date.$lte = new Date(end_date);
            }
        }

        const logs = await TrainingLog.find(query);

        let totalHours = 0;
        let completedCount = 0;
        let categoryBreakdown = {};
        const trainings = [];

        logs.forEach(log => {
            totalHours += log.hours_spent;
            if (log.training_status === 'completed') {
                completedCount += 1;
            }

            if (!categoryBreakdown[log.training_category]) {
                categoryBreakdown[log.training_category] = { count: 0, hours: 0 };
            }
            categoryBreakdown[log.training_category].count += 1;
            categoryBreakdown[log.training_category].hours += log.hours_spent;

            trainings.push({
                title: log.training_title,
                date: log.training_date,
                hours: log.hours_spent,
                category: log.training_category,
                status: log.training_status,
                competency_achieved: log.competency_achieved
            });
        });

        res.json({
            success: true,
            data: {
                total_training_hours: parseFloat(totalHours.toFixed(2)),
                training_count: logs.length,
                completed_training: completedCount,
                category_breakdown: categoryBreakdown,
                trainings: trainings
            }
        });
    } catch (error) {
        console.error('Error fetching training summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get organization training summary
router.get('/:supervisorKey/summary/organization', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const query = { supervisor_key: supervisorKey };

        if (start_date || end_date) {
            query.training_date = {};
            if (start_date) {
                query.training_date.$gte = new Date(start_date);
            }
            if (end_date) {
                query.training_date.$lte = new Date(end_date);
            }
        }

        const logs = await TrainingLog.find(query);

        let totalHours = 0;
        let uniqueTechnicians = new Set();
        let categoryBreakdown = {};
        let competencyCount = 0;

        logs.forEach(log => {
            totalHours += log.hours_spent;
            uniqueTechnicians.add(log.technician_id.toString());

            if (!categoryBreakdown[log.training_category]) {
                categoryBreakdown[log.training_category] = { count: 0, hours: 0, techs: 0 };
            }
            categoryBreakdown[log.training_category].count += 1;
            categoryBreakdown[log.training_category].hours += log.hours_spent;

            if (log.competency_achieved) {
                competencyCount += 1;
            }
        });

        res.json({
            success: true,
            data: {
                total_training_hours: parseFloat(totalHours.toFixed(2)),
                total_trainings: logs.length,
                technicians_trained: uniqueTechnicians.size,
                competencies_achieved: competencyCount,
                category_breakdown: categoryBreakdown,
                average_training_per_technician: uniqueTechnicians.size > 0 
                    ? parseFloat((totalHours / uniqueTechnicians.size).toFixed(2))
                    : 0
            }
        });
    } catch (error) {
        console.error('Error fetching organization training summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Approve training
router.post('/:supervisorKey/:trainingLogId/approve', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, trainingLogId } = req.params;

        const trainingLog = await TrainingLog.findById(trainingLogId);
        if (!trainingLog || trainingLog.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Training log not found' });
        }

        trainingLog.approval_status = 'approved';
        trainingLog.approved_by = req.user?.id || 'system';
        trainingLog.approved_date = new Date();

        await trainingLog.save();

        res.json({
            success: true,
            data: trainingLog,
            message: 'Training approved'
        });
    } catch (error) {
        console.error('Error approving training:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
