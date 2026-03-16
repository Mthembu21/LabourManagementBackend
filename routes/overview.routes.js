const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const TimeLog = require('../models/TimeLog');
const { requireAuth, tenantQuery } = require('../middleware/auth');

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

        const byWorkshop = {};
        let totalJobsOpened = 0;
        let totalHoursConsumed = 0;
        let totalAllocated = 0;
        let totalUtilized = 0;

        for (const k of keys) {
            const jobs = await Job.find(tenantQuery(k)).limit(500);
            const logs = await TimeLog.find({ ...tenantQuery(k) }).limit(5000);

            const jobsOpened = jobs.length;
            const hoursConsumed = logs.reduce((sum, l) => sum + Number(l.hours_logged || 0), 0);

            const allocatedTotal = jobs.reduce((sum, j) => sum + Number(j.allocated_hours || 0), 0);
            const utilizedTotal = jobs.reduce((sum, j) => sum + Number(j.total_hours_utilized || j.consumed_hours || 0), 0);
            const utilization = allocatedTotal > 0 ? Math.max(0, Math.min(100, (utilizedTotal / allocatedTotal) * 100)) : 0;

            byWorkshop[k] = {
                key: k,
                label: keyToLabel[k] || k,
                jobs_opened: jobsOpened,
                hours_consumed: hoursConsumed,
                allocated_hours: allocatedTotal,
                utilized_hours: utilizedTotal,
                utilization_percentage: utilization
            };

            totalJobsOpened += jobsOpened;
            totalHoursConsumed += hoursConsumed;
            totalAllocated += allocatedTotal;
            totalUtilized += utilizedTotal;
        }

        const utilizationAll = totalAllocated > 0
            ? Math.max(0, Math.min(100, (totalUtilized / totalAllocated) * 100))
            : 0;

        res.json({
            total_jobs_opened: totalJobsOpened,
            total_hours_consumed: totalHoursConsumed,
            labour_utilization_percentage: utilizationAll,
            allocated_hours: totalAllocated,
            utilized_hours: totalUtilized,
            by_workshop: byWorkshop
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
