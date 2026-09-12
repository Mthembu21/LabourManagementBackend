const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const TimeLog = require('../models/TimeLog');
const JobReport = require('../models/JobReport');
const AttendanceRecord = require('../models/AttendanceRecord');
const KPICalculator = require('../services/kpiCalculator');
const jobRoutes = require('./job.routes');
const { requireAuth, tenantQuery } = require('../middleware/auth');

const WORKSHOP_KEYS = ['component', 'pdis', 'rebuild', 'kathu'];

const keyToLabel = {
    component: 'Components',
    pdis: 'PDI',
    rebuild: 'Rebuild',
    kathu: 'Kathu'
};

const getMonthRange = (monthStr) => {
    const m = String(monthStr || '').trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return null;
    // Use local time boundaries; TimeLog.normalizeLogDate() uses local time.
    const start = new Date(`${m}-01T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
    return { start, end };
};

const requireManager = (req, res, next) => {
    if (!req.session.user || req.session.user.type !== 'supervisor') {
        return res.status(403).json({ error: 'Supervisor access required' });
    }
    if ((req.session.user.role || 'supervisor') !== 'manager') {
        return res.status(403).json({ error: 'Manager access required' });
    }
    const access = Array.isArray(req.session.user.access) ? req.session.user.access : [];
    if (!access.includes('workshop_overview')) {
        return res.status(403).json({ error: 'Not allowed to access workshop overview' });
    }
    next();
};

// Legacy month-only summary (kept for backward compatibility with any existing
// caller). This previously threw on every request - AttendanceRecord was used
// below but never required in this file, so the absence-day lookup always hit
// a ReferenceError and the whole endpoint 500'd regardless of the month.
router.get('/workshop', requireAuth, requireManager, async (req, res) => {
    try {
        const keys = WORKSHOP_KEYS;

        const month = req.query?.month ? String(req.query.month) : '';
        const range = getMonthRange(month);

        const byWorkshop = {};
        let totalJobsOpened = 0;
        let totalHoursConsumed = 0;
        let totalProductive = 0;
        let totalNonProductive = 0;

        for (const k of keys) {
            const jobs = await Job.find(tenantQuery(k)).limit(5000);

            const logQuery = { ...tenantQuery(k) };
            if (range) {
                logQuery.log_date = { $gte: range.start, $lt: range.end };
            }
            const logs = await TimeLog.find(logQuery).limit(20000);

            // Build set of absence day technician-date combinations (approved AttendanceRecord only)
            const absenceQuery = {
                supervisor_key: k,
                status: 'approved',
                attendance_type: { $in: ['leave', 'sick'] }
            };
            if (range) {
                absenceQuery.date = { $gte: range.start, $lt: range.end };
            }

            // Referenced for parity with the per-technician KPI engine's absence
            // handling, though this legacy summary doesn't currently subtract
            // absence hours from its own totals below.
            await AttendanceRecord.find(absenceQuery).select({ technician_id: 1, date: 1 });

            const jobsOpened = jobs.length;
            const hoursConsumed = logs.reduce((sum, l) => sum + Number(l.hours_logged || 0), 0);

            // Categorize hours properly for utilization calculation
            const productiveHours = logs.reduce((sum, l) => {
                if (l.is_idle) return sum;
                if (['Training', 'Leave', 'Sick', 'Team Building'].includes(l.category)) return sum;
                return sum + Number(l.hours_logged || 0);
            }, 0);

            const idleHours = logs.reduce((sum, l) =>
                l.is_idle && !['Training', 'Leave', 'Sick', 'Team Building'].includes(l.category)
                    ? sum + Number(l.hours_logged || 0)
                    : sum, 0);

            const housekeepingHours = logs.reduce((sum, l) =>
                l.category === 'Housekeeping'
                    ? sum + Number(l.hours_logged || 0)
                    : sum, 0);

            // Available Hours = Productive + Idle + Housekeeping (exclude training & leave)
            const availableHours = productiveHours + idleHours + housekeepingHours;
            const utilization = availableHours > 0 ? Math.max(0, Math.min(100, (productiveHours / availableHours) * 100)) : 0;

            byWorkshop[k] = {
                key: k,
                label: keyToLabel[k] || k,
                jobs_opened: jobsOpened,
                hours_consumed: hoursConsumed,
                productive_hours: productiveHours,
                non_productive_hours: idleHours + housekeepingHours,
                utilization_percentage: utilization
            };

            totalJobsOpened += jobsOpened;
            totalHoursConsumed += hoursConsumed;
            totalProductive += productiveHours;
            totalNonProductive += idleHours + housekeepingHours;
        }

        // Overall utilization should use the same formula: Productive / (Productive + Idle + Housekeeping)
        // Note: totalNonProductive now contains idle + housekeeping from the loop above
        const utilizationAll = totalProductive > 0
            ? Math.max(0, Math.min(100, (totalProductive / (totalProductive + totalNonProductive)) * 100))
            : 0;

        res.json({
            month: range ? month : null,
            total_jobs_opened: totalJobsOpened,
            total_hours_consumed: totalHoursConsumed,
            labour_utilization_percentage: utilizationAll,
            productive_hours: totalProductive,
            non_productive_hours: totalNonProductive,
            by_workshop: byWorkshop
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Full KPI parity with the per-workshop supervisor dashboard (productivity,
// utilization, efficiency, availability, non-productive %, overtime, training,
// completed/at-risk job counts), for an arbitrary date range - so the same
// daily/weekly/last_week/monthly views the supervisor dashboard offers work
// here too. Reuses KPICalculator.calculateDashboardKPIs (the exact engine
// OperationalMetricsFetcher calls per-workshop) so numbers always match what
// each workshop's own supervisor sees, instead of a second, divergent
// calculation. `combined` passes all four keys in one call - the calculator
// already supports an array of supervisor_keys for a foreman's multi-workshop
// view, so an "all workshops" total falls out of the same code path.
router.get('/kpis', requireAuth, requireManager, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required' });
        }

        const [combined, ...perWorkshop] = await Promise.all([
            KPICalculator.calculateDashboardKPIs(WORKSHOP_KEYS, start_date, end_date),
            ...WORKSHOP_KEYS.map((k) => KPICalculator.calculateDashboardKPIs(k, start_date, end_date))
        ]);

        const by_workshop = {};
        WORKSHOP_KEYS.forEach((k, i) => {
            by_workshop[k] = { key: k, label: keyToLabel[k], ...perWorkshop[i] };
        });

        res.json({ start_date, end_date, combined, by_workshop });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Every job in every workshop, enriched with the exact same live-computed
// status/progress the workshop's own supervisor dashboard shows (see
// enrichJobsWithTimeLogProgress in job.routes.js) - lets the manager browse
// or search any job regardless of which workshop owns it.
router.get('/jobs', requireAuth, requireManager, async (req, res) => {
    try {
        const byWorkshop = {};
        for (const k of WORKSHOP_KEYS) {
            const jobs = await Job.find(tenantQuery(k)).sort({ createdAt: -1 }).limit(5000);
            byWorkshop[k] = await jobRoutes.enrichJobsWithTimeLogProgress(jobs, k);
        }
        res.json(byWorkshop);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Full detail for one job in one specific workshop - status, progress,
// technicians/subtasks, hours, plus every daily report (work-completed notes
// and bottleneck/issue history) filed against it, so a manager searching by
// job number can see exactly what's happening on that job without needing
// that workshop's own supervisor login.
router.get('/job/:workshop/:jobNumber', requireAuth, requireManager, async (req, res) => {
    try {
        const { workshop, jobNumber } = req.params;
        if (!WORKSHOP_KEYS.includes(workshop)) {
            return res.status(400).json({ error: 'Unknown workshop' });
        }

        const job = await Job.findOne({ ...tenantQuery(workshop), job_number: jobNumber });
        if (!job) return res.status(404).json({ error: 'Job not found in this workshop' });

        const [enriched] = await jobRoutes.enrichJobsWithTimeLogProgress([job], workshop);
        const reports = await JobReport.find({ ...tenantQuery(workshop), job_id: jobNumber })
            .sort({ date: -1 })
            .lean();

        res.json({ job: enriched, reports });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
