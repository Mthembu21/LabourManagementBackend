const express = require('express');
const router = express.Router();
const DowntimeLog = require('../models/DowntimeLog');
const DayEntry = require('../models/DayEntry');
const Job = require('../models/Job');
const { requireAuth } = require('../middleware/auth');

/**
 * Pause/Resume Job Routes - Phase 2
 * Handles job pausing with reason tracking and downtime calculation
 * CRITICAL: Downtime does NOT reduce allocated job hours
 */

// Pause a job
router.post('/:supervisorKey/:jobId/pause', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;
        const { description } = req.body;

        // Accept both 'reason' and 'pause_reason' field names from the frontend
        const reason = req.body.reason || req.body.pause_reason;
        // Fall back to session user ID if technician_id is not explicitly sent
        const technician_id = req.body.technician_id || req.session?.user?.id;

        if (!technician_id || !reason) {
            return res.status(400).json({ error: 'Missing technician_id or reason' });
        }

        // Get or create downtime log for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let downtimeLog = await DowntimeLog.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            job_id: jobId,
            date: today
        });

        if (!downtimeLog) {
            downtimeLog = new DowntimeLog({
                supervisor_key: supervisorKey,
                technician_id,
                job_id: jobId,
                date: today,
                is_active: true
            });
        }

        // Find last pause event (if there's an unresolved pause)
        const lastEvent = downtimeLog.pause_resume_events.length > 0 
            ? downtimeLog.pause_resume_events[downtimeLog.pause_resume_events.length - 1]
            : null;

        if (lastEvent && !lastEvent.resumed_at) {
            return res.status(400).json({ error: 'Job already paused. Resume before pausing again.' });
        }

        // Add new pause event
        downtimeLog.pause_resume_events.push({
            paused_at: new Date(),
            reason,
            description: description || ''
        });

        downtimeLog.is_active = true;
        await downtimeLog.save();

        // Update job entry in DayEntry
        const dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: today
        });

        if (dayEntry) {
            const jobEntry = dayEntry.job_entries.find(e => e.job_id === jobId);
            if (jobEntry) {
                jobEntry.job_status = 'paused';
                await dayEntry.save();
            }
        }

        res.json({
            success: true,
            data: downtimeLog,
            message: `Job ${jobId} paused due to: ${reason}`
        });
    } catch (error) {
        console.error('Error pausing job:', error);
        res.status(500).json({ error: error.message });
    }
});

// Resume a job
router.post('/:supervisorKey/:jobId/resume', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;
        const technician_id = req.body.technician_id || req.session?.user?.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!technician_id) {
            return res.status(400).json({ error: 'Missing technician_id' });
        }

        // Find the most recent ACTIVE downtime log — not limited to today so
        // multi-day pauses can be resumed the following day.
        const downtimeLog = await DowntimeLog.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            job_id: jobId,
            is_active: true
        }).sort({ date: -1 });

        if (!downtimeLog) {
            return res.status(404).json({ error: 'No pause record found for this job' });
        }

        const lastEvent = downtimeLog.pause_resume_events[downtimeLog.pause_resume_events.length - 1];
        if (!lastEvent || lastEvent.resumed_at) {
            return res.status(400).json({ error: 'Job is not currently paused' });
        }

        // Calculate downtime
        const resumeTime = new Date();
        lastEvent.resumed_at = resumeTime;

        const pauseDuration = resumeTime - new Date(lastEvent.paused_at);
        lastEvent.downtime_minutes = Math.floor(pauseDuration / 60000);
        lastEvent.downtime_hours = (lastEvent.downtime_minutes / 60).toFixed(2);

        // Recalculate totals
        downtimeLog.total_pause_count = downtimeLog.pause_resume_events.length;
        let totalMinutes = 0;
        const reasons = [];

        downtimeLog.pause_resume_events.forEach(event => {
            if (event.resumed_at) {
                totalMinutes += event.downtime_minutes || 0;
            }
            if (event.reason) {
                reasons.push(event.reason);
            }
        });

        downtimeLog.total_downtime_minutes = totalMinutes;
        downtimeLog.total_downtime_hours = parseFloat((totalMinutes / 60).toFixed(2));
        downtimeLog.total_downtime_days = parseFloat((totalMinutes / (24 * 60)).toFixed(4));

        // Most common reason
        if (reasons.length > 0) {
            const reasonCounts = {};
            reasons.forEach(r => {
                reasonCounts[r] = (reasonCounts[r] || 0) + 1;
            });
            downtimeLog.primary_reason = Object.keys(reasonCounts).reduce((a, b) => 
                reasonCounts[a] > reasonCounts[b] ? a : b
            );
        }

        // Check if there are any unresolved pauses
        const hasUnresolvedPauses = downtimeLog.pause_resume_events.some(e => !e.resumed_at);
        downtimeLog.is_active = hasUnresolvedPauses;
        downtimeLog.is_resolved = !hasUnresolvedPauses;

        await downtimeLog.save();

        // Update job entry in DayEntry
        const dayEntry = await DayEntry.findOne({
            supervisor_key: supervisorKey,
            technician_id,
            date: today
        });

        if (dayEntry) {
            const jobEntry = dayEntry.job_entries.find(e => e.job_id === jobId);
            if (jobEntry) {
                jobEntry.job_status = 'active';
                jobEntry.total_downtime_hours = downtimeLog.total_downtime_hours;
                await dayEntry.save();
            }
        }

        res.json({
            success: true,
            data: downtimeLog,
            downtime_summary: {
                hours: lastEvent.downtime_hours,
                minutes: lastEvent.downtime_minutes,
                reason: lastEvent.reason
            },
            message: `Job resumed. Downtime: ${lastEvent.downtime_hours} hours`
        });
    } catch (error) {
        console.error('Error resuming job:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get downtime log for a job
router.get('/:supervisorKey/:jobId/downtime', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;
        const { technician_id, date } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            job_id: jobId
        };

        if (technician_id) {
            query.technician_id = technician_id;
        }

        if (date) {
            const dateObj = new Date(date);
            query.date = {
                $gte: dateObj,
                $lt: new Date(dateObj.getTime() + 86400000)
            };
        }

        const downtimeLogs = await DowntimeLog.find(query)
            .populate('technician_id', 'name employee_id')
            .sort({ date: -1 });

        // Aggregate totals
        let totalDowntimeHours = 0;
        let totalPauses = 0;

        downtimeLogs.forEach(log => {
            totalDowntimeHours += log.total_downtime_hours || 0;
            totalPauses += log.total_pause_count || 0;
        });

        res.json({
            success: true,
            data: downtimeLogs,
            summary: {
                total_downtime_hours: parseFloat(totalDowntimeHours.toFixed(2)),
                total_pauses: totalPauses,
                active_downtimes: downtimeLogs.filter(l => l.is_active).length
            }
        });
    } catch (error) {
        console.error('Error fetching downtime log:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get downtime summary for technician per date
router.get('/:supervisorKey/technician/:technicianId/downtime-summary', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;
        const { date } = req.query;

        const query = {
            supervisor_key: supervisorKey,
            technician_id: technicianId
        };

        if (date) {
            const dateObj = new Date(date);
            query.date = {
                $gte: dateObj,
                $lt: new Date(dateObj.getTime() + 86400000)
            };
        }

        const downtimeLogs = await DowntimeLog.find(query).sort({ date: -1 });

        const summary = {
            total_downtime_hours: 0,
            total_pauses: 0,
            reason_breakdown: {},
            job_downtime_breakdown: []
        };

        downtimeLogs.forEach(log => {
            summary.total_downtime_hours += log.total_downtime_hours || 0;
            summary.total_pauses += log.total_pause_count || 0;

            if (log.primary_reason) {
                summary.reason_breakdown[log.primary_reason] = 
                    (summary.reason_breakdown[log.primary_reason] || 0) + log.total_downtime_hours;
            }

            summary.job_downtime_breakdown.push({
                job_id: log.job_id,
                downtime_hours: log.total_downtime_hours,
                pause_count: log.total_pause_count
            });
        });

        summary.total_downtime_hours = parseFloat(summary.total_downtime_hours.toFixed(2));

        res.json({ success: true, data: summary });
    } catch (error) {
        console.error('Error fetching downtime summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get currently-paused (active) jobs for a technician — used to restore UI state on page load
router.get('/:supervisorKey/technician/:technicianId/active-pauses', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;

        const activeLogs = await DowntimeLog.find({
            supervisor_key: supervisorKey,
            technician_id: technicianId,
            is_active: true
        }).sort({ date: -1 });

        // Return as a map keyed by job_id (mirrors the frontend pausedJobs state)
        const pausedJobsMap = {};
        for (const log of activeLogs) {
            const lastUnresolved = [...(log.pause_resume_events || [])].reverse().find(e => !e.resumed_at);
            if (lastUnresolved) {
                pausedJobsMap[log.job_id] = {
                    job_id: log.job_id,
                    pause_reason: lastUnresolved.reason,
                    description: lastUnresolved.description || '',
                    paused_at: lastUnresolved.paused_at,
                    duration_hours: 0,
                };
            }
        }

        res.json({ success: true, data: pausedJobsMap });
    } catch (error) {
        console.error('Error fetching active pauses:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
