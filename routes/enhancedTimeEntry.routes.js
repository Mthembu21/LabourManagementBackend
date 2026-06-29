const express = require('express');
const router = express.Router();
const DayEntry = require('../models/DayEntry');
const WeekEntry = require('../models/WeekEntry');
const Job = require('../models/Job');
const Technician = require('../models/Technician');
const { requireAuth } = require('../middleware/auth');

/**
 * Enhanced Time Entry Routes - Phase 2
 * Uses structured Day/Week objects for improved KPI calculation
 */

// Log productive hours for a job
router.post('/:supervisorKey/productive', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { technician_id, date, job_id, subtask_id, productive_hours, notes } = req.body;

        if (!technician_id || !date || !job_id || productive_hours === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: new Date(date)
        });

        if (!dayEntry) {
            const tech = await Technician.findById(technician_id);
            const dateObj = new Date(date);
            dayEntry = new DayEntry({
                supervisor_key: supervisorKey,
                technician_id,
                technician_name: tech?.name || 'Unknown',
                date: dateObj,
                day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateObj.getDay()],
                scheduled_hours: dateObj.getDay() === 5 ? 5.5 : 7.5
            });
        }

        const jobEntryIndex = dayEntry.job_entries.findIndex(e => e.job_id === job_id);
        if (jobEntryIndex >= 0) {
            dayEntry.job_entries[jobEntryIndex].productive_hours = productive_hours;
            if (subtask_id) dayEntry.job_entries[jobEntryIndex].subtask_id = subtask_id;
            if (notes) dayEntry.job_entries[jobEntryIndex].notes = notes;
        } else {
            dayEntry.job_entries.push({
                job_id,
                job_number: job_id,
                subtask_id: subtask_id || null,
                productive_hours,
                notes: notes || ''
            });
        }

        await dayEntry.save();
        res.json({
            success: true,
            data: dayEntry,
            message: `Logged ${productive_hours} productive hours`
        });
    } catch (error) {
        console.error('Error logging productive hours:', error);
        res.status(500).json({ error: error.message });
    }
});

// Log non-productive hours
router.post('/:supervisorKey/non-productive', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { technician_id, date, category, hours, description } = req.body;

        if (!technician_id || !date || !hours) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: new Date(date)
        });

        if (!dayEntry) {
            const tech = await Technician.findById(technician_id);
            const dateObj = new Date(date);
            dayEntry = new DayEntry({
                supervisor_key: supervisorKey,
                technician_id,
                technician_name: tech?.name || 'Unknown',
                date: dateObj,
                day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateObj.getDay()],
                scheduled_hours: dateObj.getDay() === 5 ? 5.5 : 7.5
            });
        }

        dayEntry.job_entries.push({
            job_id: category,
            job_number: category,
            non_productive_hours: hours,
            notes: `${category}: ${description || ''}`
        });

        await dayEntry.save();
        res.json({ success: true, data: dayEntry });
    } catch (error) {
        console.error('Error logging non-productive hours:', error);
        res.status(500).json({ error: error.message });
    }
});

// Log idle time
router.post('/:supervisorKey/idle', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { technician_id, date, idle_hours, reason } = req.body;

        if (!technician_id || !date || idle_hours === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        let dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: new Date(date)
        });

        if (!dayEntry) {
            const tech = await Technician.findById(technician_id);
            const dateObj = new Date(date);
            dayEntry = new DayEntry({
                supervisor_key: supervisorKey,
                technician_id,
                technician_name: tech?.name || 'Unknown',
                date: dateObj,
                day_of_week: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dateObj.getDay()],
                scheduled_hours: dateObj.getDay() === 5 ? 5.5 : 7.5
            });
        }

        dayEntry.job_entries.push({
            job_id: `idle_${reason || 'general'}`,
            job_number: `Idle - ${reason || 'General'}`,
            idle_hours,
            notes: reason || 'No assignment'
        });

        await dayEntry.save();
        res.json({ success: true, data: dayEntry });
    } catch (error) {
        console.error('Error logging idle time:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add note to job entry
router.post('/:supervisorKey/add-note', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { technician_id, date, job_id, note } = req.body;

        if (!technician_id || !date || !job_id || !note) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: new Date(date)
        });

        if (!dayEntry) {
            return res.status(404).json({ error: 'Day entry not found' });
        }

        const jobEntry = dayEntry.job_entries.find(e => e.job_id === job_id);
        if (!jobEntry) {
            return res.status(404).json({ error: 'Job entry not found' });
        }

        jobEntry.notes = (jobEntry.notes || '') + '\n' + note;
        await dayEntry.save();
        res.json({ success: true, data: dayEntry });
    } catch (error) {
        console.error('Error adding note:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get day entries
router.get('/:supervisorKey/day/:date', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, date } = req.params;
        const { technician_id } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            date: {
                $gte: new Date(date),
                $lt: new Date(new Date(date).getTime() + 86400000)
            }
        };

        if (technician_id) {
            query.technician_id = technician_id;
        }

        const dayEntries = await DayEntry.find(query).populate('technician_id', 'name employee_id');
        res.json({ success: true, data: dayEntries });
    } catch (error) {
        console.error('Error fetching day entries:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get week entries
router.get('/:supervisorKey/week/:weekNum/:year', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, weekNum, year } = req.params;
        const { technician_id } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            week_number: parseInt(weekNum),
            year: parseInt(year)
        };

        if (technician_id) {
            query.technician_id = technician_id;
        }

        const weekEntries = await WeekEntry.find(query).populate('technician_id', 'name employee_id');
        res.json({ success: true, data: weekEntries });
    } catch (error) {
        console.error('Error fetching week entries:', error);
        res.status(500).json({ error: error.message });
    }
});

// Approve time entry
router.post('/:supervisorKey/approve', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { day_entry_id, approval_notes } = req.body;

        const dayEntry = await DayEntry.findById(day_entry_id);
        if (!dayEntry || dayEntry.supervisor_key !== supervisorKey) {
            return res.status(404).json({ error: 'Day entry not found' });
        }

        dayEntry.entry_status = 'approved';
        dayEntry.supervisor_approved = true;
        dayEntry.approved_by = req.user?.id || 'system';
        dayEntry.approval_date = new Date();
        dayEntry.approval_notes = approval_notes || '';

        await dayEntry.save();
        res.json({ success: true, data: dayEntry });
    } catch (error) {
        console.error('Error approving time entry:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
