const express = require('express');
const router = express.Router();
const KPICalculator = require('../services/kpiCalculator');

const { requireAuth } = require('../middleware/auth');

/**
 * KPI & Reporting Routes - Phase 4
 * Provides all KPI calculations and reporting endpoints
 */

// Get daily KPIs for technician
router.get('/:supervisorKey/technician/:technicianId/day/:date', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId, date } = req.params;

        const kpis = await KPICalculator.calculateDailyKPIs(supervisorKey, technicianId, date);

        res.json({
            success: true,
            data: kpis,
            period: 'daily',
            date: date
        });
    } catch (error) {
        console.error('Error calculating daily KPIs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get weekly KPIs for technician
router.get('/:supervisorKey/technician/:technicianId/week/:weekNum/:year', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId, weekNum, year } = req.params;

        const kpis = await KPICalculator.calculateWeeklyKPIs(
            supervisorKey,
            technicianId,
            parseInt(weekNum),
            parseInt(year)
        );

        res.json({
            success: true,
            data: kpis,
            period: 'weekly',
            week: weekNum,
            year: year
        });
    } catch (error) {
        console.error('Error calculating weekly KPIs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get monthly KPIs for technician
router.get('/:supervisorKey/technician/:technicianId/month/:month/:year', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId, month, year } = req.params;

        const kpis = await KPICalculator.calculateMonthlyKPIs(supervisorKey, technicianId, month, year);

        res.json({
            success: true,
            data: kpis
        });
    } catch (error) {
        console.error('Error calculating monthly KPIs:', error);
        res.status(500).json({ error: error.message });
    }
});

// A foreman's `access` list names workshops by their access-key, not their
// supervisor_key — this is the reverse of the tenantToAccess mapping in
// auth.routes.js switch-tenant (kept in sync with it).
const ACCESS_KEY_TO_SUPERVISOR_KEYS = {
    components: ['component', 'kathu'],
    pdi: ['pdis'],
    rebuild: ['rebuild']
};

// Get dashboard KPIs for supervisor (optionally filtered by technician_id)
router.get('/:supervisorKey/dashboard/overview', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        let { start_date, end_date, technician_id } = req.query;

        // Security: technicians can only view their own KPI data.
        // Override any client-supplied technician_id with the authenticated session ID.
        // This prevents accessing team totals (no ID) or another technician's data (wrong ID).
        if (req.session.user?.type === 'technician') {
            const sessionTechId = String(req.session.user.id || '');
            if (!sessionTechId) {
                return res.status(403).json({ error: 'Unable to identify technician session' });
            }
            technician_id = sessionTechId;
        }

        // A foreman covering multiple workshops gets a genuinely combined KPI view
        // across all of them, rather than whichever single workshop their session
        // happens to be switched to. Other roles (supervisor, manager) keep the
        // existing single-workshop behavior — manager already has a dedicated
        // multi-workshop comparison view (Workshop Overview) with different semantics.
        let effectiveSupervisorKey = supervisorKey;
        if (req.session.user?.type === 'supervisor' && req.session.user?.role === 'foreman') {
            const access = Array.isArray(req.session.user?.access) ? req.session.user.access : [];
            const keys = [...new Set(access.flatMap((a) => ACCESS_KEY_TO_SUPERVISOR_KEYS[a] || []))];
            if (keys.length) effectiveSupervisorKey = keys;
        }

        const startDate = start_date || new Date(new Date().setDate(new Date().getDate() - 30));
        const endDate = end_date || new Date();

        const dashboardKPIs = await KPICalculator.calculateDashboardKPIs(
            effectiveSupervisorKey,
            startDate,
            endDate,
            technician_id
        );

        res.json({
            success: true,
            data: dashboardKPIs
        });
    } catch (error) {
        console.error('Error calculating dashboard KPIs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get KPI trends (over time) - pass-through to the single KPI engine
router.get('/:supervisorKey/trends/utilization', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const trends = await KPICalculator.calculateTrendKPIs(
            'utilization',
            supervisorKey,
            { start_date, end_date }
        );

        res.json({ success: true, data: trends });
    } catch (error) {
        console.error('Error fetching utilization trends:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:supervisorKey/trends/productivity', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const trends = await KPICalculator.calculateTrendKPIs(
            'productivity',
            supervisorKey,
            { start_date, end_date }
        );

        res.json({ success: true, data: trends });
    } catch (error) {
        console.error('Error fetching productivity trends:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:supervisorKey/trends/efficiency', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const trends = await KPICalculator.calculateTrendKPIs(
            'efficiency',
            supervisorKey,
            { start_date, end_date }
        );

        res.json({ success: true, data: trends });
    } catch (error) {
        console.error('Error fetching efficiency trends:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:supervisorKey/trends/overtime', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { start_date, end_date } = req.query;

        const trends = await KPICalculator.calculateTrendKPIs(
            'overtime',
            supervisorKey,
            { start_date, end_date }
        );

        res.json({ success: true, data: trends });
    } catch (error) {
        console.error('Error fetching overtime trends:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

