const express = require('express');
const router = express.Router();
const TimeLog = require('../models/TimeLog');
const { startOfMonth, endOfMonth, parseISO } = require('date-fns');

// Middleware for authentication
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Helper function to get tenant query
const tenantQuery = (supervisorKey) => ({
    supervisor_key: supervisorKey
});

// GET /api/metrics/utilization?techId=&dateRange=
router.get('/', requireAuth, async (req, res) => {
    try {
        const { techId, dateRange } = req.query;
        const supervisorKey = req.tenant.supervisor_key;
        
        if (!techId) {
            return res.status(400).json({ error: 'technician_id is required' });
        }
        
        if (!dateRange) {
            return res.status(400).json({ error: 'dateRange is required (format: YYYY-MM)' });
        }
        
        // Parse date range
        const [year, month] = dateRange.split('-');
        const startDate = startOfMonth(parseISO(`${year}-${month}-01`));
        const endDate = endOfMonth(startDate);
        
        // Calculate operational metrics using new formulas
        const metrics = await TimeLog.calculateOperationalMetrics(
            supervisorKey,
            techId,
            startDate,
            endDate
        );
        
        res.json({
            success: true,
            data: {
                productiveHours: metrics.productiveHours,
                nonProductiveHours: metrics.nonProductiveHours,
                idleHours: metrics.idleHours,
                notAvailableHours: metrics.notAvailableHours,
                adjustedAvailableHours: metrics.adjustedAvailableHours,
                utilization: metrics.utilization,
                productivity: metrics.productivity,
                idlePercentage: metrics.idlePercentage,
                totalProductivity: metrics.totalProductivity
            }
        });
        
    } catch (error) {
        console.error('Error calculating utilization metrics:', error);
        res.status(500).json({ 
            error: 'Failed to calculate utilization metrics',
            details: error.message 
        });
    }
});

// GET /api/metrics/utilization/daily?techId=&dateRange=
router.get('/daily', requireAuth, async (req, res) => {
    try {
        const { techId, dateRange } = req.query;
        const supervisorKey = req.tenant.supervisor_key;
        
        if (!techId) {
            return res.status(400).json({ error: 'technician_id is required' });
        }
        
        if (!dateRange) {
            return res.status(400).json({ error: 'dateRange is required (format: YYYY-MM)' });
        }
        
        // Parse date range
        const [year, month] = dateRange.split('-');
        const startDate = startOfMonth(parseISO(`${year}-${month}-01`));
        const endDate = endOfMonth(startDate);
        
        // Calculate daily operational metrics
        const dailyMetrics = await TimeLog.calculateDailyOperationalMetrics(
            supervisorKey,
            techId,
            startDate,
            endDate
        );
        
        res.json({
            success: true,
            data: dailyMetrics
        });
        
    } catch (error) {
        console.error('Error calculating daily utilization metrics:', error);
        res.status(500).json({ 
            error: 'Failed to calculate daily utilization metrics',
            details: error.message 
        });
    }
});

// GET /api/metrics/utilization/batch?dateRange=
router.get('/batch', requireAuth, async (req, res) => {
    try {
        const { dateRange } = req.query;
        const supervisorKey = req.tenant.supervisor_key;
        
        if (!dateRange) {
            return res.status(400).json({ error: 'dateRange is required (format: YYYY-MM)' });
        }
        
        // Parse date range
        const [year, month] = dateRange.split('-');
        const startDate = startOfMonth(parseISO(`${year}-${month}-01`));
        const endDate = endOfMonth(startDate);
        
        // Get all technicians for this supervisor
        const Technician = require('../models/Technician');
        const technicians = await Technician.find({ supervisor_key: supervisorKey });
        
        // Calculate metrics for all technicians
        const batchMetrics = [];
        for (const tech of technicians) {
            const metrics = await TimeLog.calculateOperationalMetrics(
                supervisorKey,
                tech._id,
                startDate,
                endDate
            );
            
            batchMetrics.push({
                technicianId: tech._id,
                technicianName: tech.name,
                ...metrics
            });
        }
        
        res.json({
            success: true,
            data: batchMetrics
        });
        
    } catch (error) {
        console.error('Error calculating batch utilization metrics:', error);
        res.status(500).json({ 
            error: 'Failed to calculate batch utilization metrics',
            details: error.message 
        });
    }
});

module.exports = router;
