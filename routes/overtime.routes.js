const express = require('express');
const router = express.Router();
const OvertimeLog = require('../models/OvertimeLog');
const DayEntry = require('../models/DayEntry');
const Technician = require('../models/Technician');
const { requireAuth } = require('../middleware/auth');

/**
 * Overtime Management Routes - Phase 2
 * Handles manual overtime logging separate from productive hours
 */

// Log overtime for a job
router.post('/:supervisorKey/log', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { 
            technician_id, 
            date, 
            job_id, 
            subtask_id, 
            overtime_hours, 
            overtime_rate,
            reason, 
            description,
            logged_by 
        } = req.body;

        if (!technician_id || !date || !job_id || !overtime_hours || !reason) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const tech = await Technician.findById(technician_id);
        const dateObj = new Date(date);

        const overtimeLog = new OvertimeLog({
            supervisor_key: supervisorKey,
            technician_id,
            technician_name: tech?.name || 'Unknown',
            job_id,
            job_number: job_id,
            subtask_id: subtask_id || null,
            date: dateObj,
            day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateObj.getDay()],
            overtime_hours,
            overtime_rate: overtime_rate || 1.5,
            reason,
            description: description || '',
            logged_by: logged_by || 'technician',
            logged_at: new Date(),
            is_manually_logged: true
        });

        await overtimeLog.save();

        res.json({
            success: true,
            data: overtimeLog,
            message: `Overtime logged: ${overtime_hours} hours at rate ${overtimeLog.overtime_rate}x = ${overtimeLog.payable_hours} payable hours`
        });
    } catch (error) {
        console.error('Error logging overtime:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get overtime logs
router.get('/:supervisorKey/logs', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { technician_id, start_date, end_date, approval_status } = req.query;

        const query = { supervisor_key: supervisorKey };

        if (technician_id) {
            query.technician_id = technician_id;
        }

        if (start_date || end_date) {
            query.date = {};
            if (start_date) {
                query.date.$gte = new Date(start_date);
            }
            if (end_date) {
                query.date.$lte = new Date(end_date);
            }
        }

        if (approval_status) {
            query.approval_status = approval_status;
        }

        const logs = await OvertimeLog.find(query)
            .populate('technician_id', 'name employee_id')
            .sort({ date: -1 });

        res.json({
            success: true,
            data: logs,
            count: logs.length
        });
    } catch (error) {
        console.error('Error fetching overtime logs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get overtime summary for technician
router.get('/:supervisorKey/summary/technician/:technicianId', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;
        const { start_date, end_date } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            technician_id: technicianId
        };

        if (start_date || end_date) {
            query.date = {};
            if (start_date) {
                query.date.$gte = new Date(start_date);
            }
            if (end_date) {
                query.date.$lte = new Date(end_date);
            }
        }

        const logs = await OvertimeLog.find(query);

        let totalOvertimeHours = 0;
        let totalPayableHours = 0;
        let approvedHours = 0;
        let pendingHours = 0;
        const reasonBreakdown = {};
        const jobBreakdown = {};

        logs.forEach(log => {
            totalOvertimeHours += log.overtime_hours;
            totalPayableHours += log.payable_hours;

            if (log.approval_status === 'approved') {
                approvedHours += log.payable_hours;
            } else if (log.approval_status === 'pending') {
                pendingHours += log.payable_hours;
            }

            // Reason breakdown
            reasonBreakdown[log.reason] = (reasonBreakdown[log.reason] || 0) + log.overtime_hours;

            // Job breakdown
            if (!jobBreakdown[log.job_id]) {
                jobBreakdown[log.job_id] = { hours: 0, payable_hours: 0, count: 0 };
            }
            jobBreakdown[log.job_id].hours += log.overtime_hours;
            jobBreakdown[log.job_id].payable_hours += log.payable_hours;
            jobBreakdown[log.job_id].count += 1;
        });

        res.json({
            success: true,
            data: {
                total_overtime_hours: parseFloat(totalOvertimeHours.toFixed(2)),
                total_payable_hours: parseFloat(totalPayableHours.toFixed(2)),
                approved_payable_hours: parseFloat(approvedHours.toFixed(2)),
                pending_payable_hours: parseFloat(pendingHours.toFixed(2)),
                logs_count: logs.length,
                reason_breakdown: reasonBreakdown,
                job_breakdown: jobBreakdown
            }
        });
    } catch (error) {
        console.error('Error fetching overtime summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Approve overtime
router.post('/:supervisorKey/:overtimeLogId/approve', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, overtimeLogId } = req.params;
        const { approval_notes } = req.body;

        const overtimeLog = await OvertimeLog.findById(overtimeLogId);
        if (!overtimeLog || overtimeLog.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Overtime log not found' });
        }

        overtimeLog.approval_status = 'approved';
        overtimeLog.approved_by = req.user?.id || 'system';
        overtimeLog.approved_date = new Date();
        overtimeLog.approval_notes = approval_notes || '';
        overtimeLog.overtime_status = 'approved';

        await overtimeLog.save();

        res.json({
            success: true,
            data: overtimeLog,
            message: 'Overtime approved'
        });
    } catch (error) {
        console.error('Error approving overtime:', error);
        res.status(500).json({ error: error.message });
    }
});

// Reject overtime
router.post('/:supervisorKey/:overtimeLogId/reject', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, overtimeLogId } = req.params;
        const { approval_notes } = req.body;

        const overtimeLog = await OvertimeLog.findById(overtimeLogId);
        if (!overtimeLog || overtimeLog.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Overtime log not found' });
        }

        overtimeLog.approval_status = 'rejected';
        overtimeLog.approved_by = req.user?.id || 'system';
        overtimeLog.approved_date = new Date();
        overtimeLog.approval_notes = approval_notes || '';
        overtimeLog.overtime_status = 'rejected';

        await overtimeLog.save();

        res.json({
            success: true,
            data: overtimeLog,
            message: 'Overtime rejected'
        });
    } catch (error) {
        console.error('Error rejecting overtime:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
