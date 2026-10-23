const express = require('express');
const router = express.Router();
const JobReport = require('../models/JobReport');
const Technician = require('../models/Technician');
const { requireAuth, tenantQuery } = require('../middleware/auth');

// Get all job reports
router.get('/', requireAuth, async (req, res) => {
    try {
        // ?job_id= returns every report for that one job (the job details view), instead
        // of only the workshop's latest 200, which dropped older notes on long jobs.
        let query = tenantQuery(req.tenant.supervisor_key);
        // Same as /time-entries?scope=own_technicians: also include reports filed by this
        // workshop's own technicians on other workshops' jobs (stored under that workshop).
        if (req.query.scope === 'own_technicians' && req.session.user?.type === 'supervisor') {
            const ownTechIds = (await Technician.find(tenantQuery(req.tenant.supervisor_key)).select({ _id: 1 }).lean()).map((t) => t._id);
            query = { $or: [tenantQuery(req.tenant.supervisor_key), { technician_id: { $in: ownTechIds } }] };
        }
        const jobId = typeof req.query.job_id === 'string' ? req.query.job_id.trim() : '';
        if (jobId) query.job_id = jobId;
        // ?start_date=&end_date= (yyyy-MM-dd, inclusive) returns every report in that
        // period, e.g. the dashboard's selected month, not just the latest 200.
        const start = req.query.start_date ? new Date(req.query.start_date) : null;
        const end = req.query.end_date ? new Date(req.query.end_date) : null;
        const hasRange = (start && !Number.isNaN(start.getTime())) || (end && !Number.isNaN(end.getTime()));
        if (hasRange) {
            query.date = {};
            if (start && !Number.isNaN(start.getTime())) { start.setHours(0, 0, 0, 0); query.date.$gte = start; }
            if (end && !Number.isNaN(end.getTime())) { end.setHours(23, 59, 59, 999); query.date.$lte = end; }
        }
        const reports = await JobReport.find(query).sort({ date: -1 }).limit(jobId || hasRange ? 5000 : 200);
        res.json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;