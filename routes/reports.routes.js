const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const DayEntry = require('../models/DayEntry');
const OvertimeLog = require('../models/OvertimeLog');
const { requireAuth } = require('../middleware/auth');
const KPICalculator = require('../services/kpiCalculator');


/**
 * Reports API - Phase 4
 * Generates detailed reports for completed jobs, technician performance, etc.
 */


// Get completed job report (detailed breakdown) - pass-through to the single KPI engine
router.get('/:supervisorKey/job/:jobId/completion', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, jobId } = req.params;

        const report = await KPICalculator.calculateJobCompletionReport(supervisorKey, jobId);

        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error generating job completion report:', error);
        res.status(500).json({ error: error.message });
    }
});


// Get technician performance report - pass-through to the single KPI engine
router.get('/:supervisorKey/technician/:technicianId/performance', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;
        const { start_date, end_date } = req.query;

        const report = await KPICalculator.calculateTechnicianPerformanceReport(supervisorKey, technicianId, {
            start_date,
            end_date
        });

        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error generating technician performance report:', error);
        res.status(500).json({ error: error.message });
    }
});


// Get supervisor performance summary - pass-through to the single KPI engine
router.get('/:supervisorKey/performance-summary', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const report = await KPICalculator.calculateSupervisorPerformanceSummary(supervisorKey, {
            start_date,
            end_date
        });

        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Error generating performance summary:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
