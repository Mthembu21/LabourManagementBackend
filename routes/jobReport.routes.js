const express = require('express');
const router = express.Router();
const JobReport = require('../models/JobReport');
const { requireAuth } = require('../middleware/auth');

// Get all job reports
router.get('/', requireAuth, async (req, res) => {
    try {
        const reports = await JobReport.find().sort({ date: -1 }).limit(200);
        res.json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;