const express = require('express');
const router = express.Router();
const AttendanceRecord = require('../models/AttendanceRecord');
const Technician = require('../models/Technician');
const { requireAuth } = require('../middleware/auth');

// Middleware to ensure user is authenticated and has supervisor access
const requireSupervisor = (req, res, next) => {
    if (!req.session?.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// POST: Create leave day
router.post('/leave', requireAuth, requireSupervisor, async (req, res) => {
    try {
        const { technician_id, date, notes = '' } = req.body;
        const supervisorKey = req.tenant?.supervisor_key || 'component';

        // Validate required fields
        if (!technician_id || !date) {
            return res.status(400).json({ error: 'technician_id and date are required' });
        }

        // Validate date is a valid date
        const leaveDate = new Date(date);
        if (isNaN(leaveDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Validate date is a weekday (not weekend)
        const dayOfWeek = leaveDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return res.status(400).json({ error: 'Cannot create leave record for weekend' });
        }

        // Check if technician exists
        const technician = await Technician.findById(technician_id);
        if (!technician) {
            return res.status(404).json({ error: 'Technician not found' });
        }

        // Check if leave already exists for this date
        const existing = await AttendanceRecord.findOne({
            supervisor_key: supervisorKey,
            technician_id: technician_id,
            date: { $gte: new Date(leaveDate.setHours(0, 0, 0, 0)), $lt: new Date(leaveDate.setHours(24, 0, 0, 0)) }
        });

        if (existing) {
            return res.status(409).json({
                error: 'Attendance record already exists for this date',
                existing_type: existing.attendance_type
            });
        }

        // Create leave record
        const attendanceRecord = new AttendanceRecord({
            supervisor_key: supervisorKey,
            technician_id: technician_id,
            technician_name: technician.name,
            date: new Date(date),
            attendance_type: 'leave',
            notes: notes,
            status: 'pending', // Default to pending, require approval
            created_by: req.session.user.id
        });

        await attendanceRecord.save();

        return res.status(201).json({
            message: 'Leave record created successfully',
            attendance_record: attendanceRecord
        });
    } catch (error) {
        console.error('Error creating leave record:', error);
        return res.status(500).json({ error: 'Error creating leave record', details: error.message });
    }
});

// POST: Create sick day
router.post('/sick', requireAuth, requireSupervisor, async (req, res) => {
    try {
        const { technician_id, date, notes = '' } = req.body;
        const supervisorKey = req.tenant?.supervisor_key || 'component';

        // Validate required fields
        if (!technician_id || !date) {
            return res.status(400).json({ error: 'technician_id and date are required' });
        }

        // Validate date is a valid date
        const sickDate = new Date(date);
        if (isNaN(sickDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Validate date is a weekday (not weekend)
        const dayOfWeek = sickDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return res.status(400).json({ error: 'Cannot create sick record for weekend' });
        }

        // Check if technician exists
        const technician = await Technician.findById(technician_id);
        if (!technician) {
            return res.status(404).json({ error: 'Technician not found' });
        }

        // Check if sick leave already exists for this date
        const existing = await AttendanceRecord.findOne({
            supervisor_key: supervisorKey,
            technician_id: technician_id,
            date: { $gte: new Date(sickDate.setHours(0, 0, 0, 0)), $lt: new Date(sickDate.setHours(24, 0, 0, 0)) }
        });

        if (existing) {
            return res.status(409).json({
                error: 'Attendance record already exists for this date',
                existing_type: existing.attendance_type
            });
        }

        // Create sick record
        const attendanceRecord = new AttendanceRecord({
            supervisor_key: supervisorKey,
            technician_id: technician_id,
            technician_name: technician.name,
            date: new Date(date),
            attendance_type: 'sick',
            notes: notes,
            status: 'pending', // Default to pending, require approval
            created_by: req.session.user.id
        });

        await attendanceRecord.save();

        return res.status(201).json({
            message: 'Sick record created successfully',
            attendance_record: attendanceRecord
        });
    } catch (error) {
        console.error('Error creating sick record:', error);
        return res.status(500).json({ error: 'Error creating sick record', details: error.message });
    }
});

// GET: Get attendance records for a technician in date range
router.get('/:technicianId/range', requireAuth, requireSupervisor, async (req, res) => {
    try {
        const { technicianId } = req.params;
        const { start_date, end_date, status = null } = req.query;
        const supervisorKey = req.tenant?.supervisor_key || 'component';

        // Validate date parameters
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required' });
        }

        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Build query
        const query = {
            supervisor_key: supervisorKey,
            technician_id: technicianId,
            date: { $gte: startDate, $lte: endDate }
        };

        if (status) {
            query.status = status;
        }

        const records = await AttendanceRecord.find(query).sort({ date: 1 });

        // Calculate summary
        const summary = {
            total_records: records.length,
            approved: records.filter(r => r.status === 'approved').length,
            pending: records.filter(r => r.status === 'pending').length,
            declined: records.filter(r => r.status === 'declined').length,
            leave_days: records.filter(r => r.attendance_type === 'leave' && r.status === 'approved').length,
            sick_days: records.filter(r => r.attendance_type === 'sick' && r.status === 'approved').length,
            total_hours: records
                .filter(r => r.status === 'approved')
                .reduce((sum, r) => sum + (r.hours_credited || 0), 0)
        };

        return res.status(200).json({
            records,
            summary
        });
    } catch (error) {
        console.error('Error fetching attendance records:', error);
        return res.status(500).json({ error: 'Error fetching attendance records', details: error.message });
    }
});

// PUT: Approve attendance record
router.put('/:id/approve', requireAuth, requireSupervisor, async (req, res) => {
    try {
        const { id } = req.params;
        const { approval_notes = '' } = req.body;

        const record = await AttendanceRecord.findById(id);
        if (!record) {
            return res.status(404).json({ error: 'Attendance record not found' });
        }

        // Update approval status
        record.status = 'approved';
        record.approved_by = req.session.user.username || req.session.user.email;
        record.approved_at = new Date();
        record.approval_notes = approval_notes;

        await record.save();

        return res.status(200).json({
            message: 'Attendance record approved successfully',
            attendance_record: record
        });
    } catch (error) {
        console.error('Error approving attendance record:', error);
        return res.status(500).json({ error: 'Error approving attendance record', details: error.message });
    }
});

// PUT: Decline attendance record
router.put('/:id/decline', requireAuth, requireSupervisor, async (req, res) => {
    try {
        const { id } = req.params;
        const { approval_notes = '' } = req.body;

        const record = await AttendanceRecord.findById(id);
        if (!record) {
            return res.status(404).json({ error: 'Attendance record not found' });
        }

        // Update approval status
        record.status = 'declined';
        record.approved_by = req.session.user.username || req.session.user.email;
        record.approved_at = new Date();
        record.approval_notes = approval_notes || 'Declined';

        await record.save();

        return res.status(200).json({
            message: 'Attendance record declined successfully',
            attendance_record: record
        });
    } catch (error) {
        console.error('Error declining attendance record:', error);
        return res.status(500).json({ error: 'Error declining attendance record', details: error.message });
    }
});

// DELETE: Delete attendance record (only if pending)
router.delete('/:id', requireAuth, requireSupervisor, async (req, res) => {
    try {
        const { id } = req.params;

        const record = await AttendanceRecord.findById(id);
        if (!record) {
            return res.status(404).json({ error: 'Attendance record not found' });
        }

        // Only allow deletion if pending
        if (record.status !== 'pending') {
            return res.status(400).json({ error: 'Can only delete pending records' });
        }

        await AttendanceRecord.findByIdAndDelete(id);

        return res.status(200).json({ message: 'Attendance record deleted successfully' });
    } catch (error) {
        console.error('Error deleting attendance record:', error);
        return res.status(500).json({ error: 'Error deleting attendance record', details: error.message });
    }
});

module.exports = router;
