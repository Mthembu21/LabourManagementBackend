const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const TimeLog = require('../models/TimeLog');
const { requireAuth, tenantQuery } = require('../middleware/auth');

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

const keyToLabel = {
    component: 'Components',
    pdis: 'PDI',
    rebuild: 'Rebuild'
};

router.get('/workshop', requireAuth, requireManager, async (req, res) => {
    try {
        const keys = ['component', 'pdis', 'rebuild'];

        const month = req.query?.month ? String(req.query.month) : '';
        const range = getMonthRange(month);

        const byWorkshop = {};
        let totalJobsOpened = 0;
        let totalHoursConsumed = 0;
        let totalProductive = 0;
        let totalNonProductive = 0;

        for (const k of keys) {
            const jobs = await Job.find(tenantQuery(k)).limit(500);

            const logQuery = { ...tenantQuery(k) };
            if (range) {
                logQuery.log_date = { $gte: range.start, $lt: range.end };
            }
            const logs = await TimeLog.find(logQuery).limit(20000);

            const jobsOpened = jobs.length;
            const hoursConsumed = logs.reduce((sum, l) => sum + Number(l.hours_logged || 0), 0);

            const productiveHours = logs.reduce((sum, l) => sum + (l?.is_idle ? 0 : Number(l?.hours_logged || 0)), 0);
            const nonProductiveHours = logs.reduce((sum, l) => sum + (l?.is_idle ? Number(l?.hours_logged || 0) : 0), 0);
            const denom = productiveHours + nonProductiveHours;
            const utilization = denom > 0 ? Math.max(0, Math.min(100, (productiveHours / denom) * 100)) : 0;

            byWorkshop[k] = {
                key: k,
                label: keyToLabel[k] || k,
                jobs_opened: jobsOpened,
                hours_consumed: hoursConsumed,
                productive_hours: productiveHours,
                non_productive_hours: nonProductiveHours,
                utilization_percentage: utilization
            };

            totalJobsOpened += jobsOpened;
            totalHoursConsumed += hoursConsumed;
            totalProductive += productiveHours;
            totalNonProductive += nonProductiveHours;
        }

        const denomAll = totalProductive + totalNonProductive;
        const utilizationAll = denomAll > 0
            ? Math.max(0, Math.min(100, (totalProductive / denomAll) * 100))
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

module.exports = router;
