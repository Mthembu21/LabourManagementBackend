const express = require('express');
const router = express.Router();
const JobReport = require('../models/JobReport');
const { requireAuth, tenantQuery } = require('../middleware/auth');

// Get all job reports
router.get('/', requireAuth, async (req, res) => {
    try {
        // ?job_id= returns every report for that one job (the job details view), instead
        // of only the workshop's latest 200, which dropped older notes on long jobs.
        const query = tenantQuery(req.tenant.supervisor_key);
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