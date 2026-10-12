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
        const reports = await JobReport.find(query).sort({ date: -1 }).limit(jobId ? 5000 : 200);
        res.json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;