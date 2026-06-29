const express = require('express');
const router = express.Router();
const DayEntry = require('../models/DayEntry');
const Job = require('../models/Job');
const OvertimeLog = require('../models/OvertimeLog');
const DowntimeLog = require('../models/DowntimeLog');
const { requireAuth } = require('../middleware/auth');

/**
 * Alerts & Monitoring API - Phase 4
 * Triggers alerts based on KPI thresholds and business rules
 */

// Get all alerts for technician
router.get('/:supervisorKey/technician/:technicianId/alerts', requireAuth, async (req, res) => {
    try {
        const { supervisorKey, technicianId } = req.params;
        const { severity } = req.query; // 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'

        const alerts = [];

        // Check utilization
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

        const weekDayEntries = await DayEntry.find({
            supervisor_key: supervisorKey,
            technician_id: technicianId,
            date: { $gte: weekStart, $lt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) }
        });

        let weeklyProductive = 0;
        let weeklyAvailable = 0;

        weekDayEntries.forEach(entry => {
            weeklyProductive += entry.total_productive_hours || 0;
            weeklyAvailable += entry.available_productive_hours || 0;
        });

        const utilizationPercent = weeklyAvailable > 0 ? (weeklyProductive / weeklyAvailable) * 100 : 0;

        if (utilizationPercent < 30) {
            alerts.push({
                alert_id: `LOW_UTIL_${technicianId}_${Date.now()}`,
                type: 'LOW_UTILIZATION',
                severity: 'MEDIUM',
                title: 'Low Utilization',
                description: `Technician utilization is ${utilizationPercent.toFixed(2)}% this week (target: >70%)`,
                threshold: 30,
                current_value: utilizationPercent,
                triggered_at: new Date(),
                recommendation: 'Consider assigning more work or investigating if technician is unavailable'
            });
        } else if (utilizationPercent < 60 && utilizationPercent >= 30) {
            alerts.push({
                alert_id: `MEDIUM_UTIL_${technicianId}_${Date.now()}`,
                type: 'MEDIUM_UTILIZATION',
                severity: 'LOW',
                title: 'Medium Utilization',
                description: `Technician utilization is ${utilizationPercent.toFixed(2)}% this week (target: >70%)`,
                threshold: 60,
                current_value: utilizationPercent,
                triggered_at: new Date(),
                recommendation: 'Consider assigning additional work to improve utilization'
            });
        }

        // Check for over-allocation
        const activejobs = await Job.find({
            supervisor_key: supervisorKey,
            'technicians.technician_id': technicianId,
            status: { $in: ['active', 'in_progress'] }
        });

        const totalAllocated = activejobs.reduce((sum, j) => {
            const assignment = j.technicians.find(t => t.technician_id.toString() === technicianId.toString());
            return sum + (assignment?.allocated_hours || 0);
        }, 0);

        if (totalAllocated > 37.5 * 4) {
            alerts.push({
                alert_id: `OVERALLOCATED_${technicianId}_${Date.now()}`,
                type: 'OVERALLOCATED',
                severity: 'CRITICAL',
                title: 'Technician Over-Allocated',
                description: `Technician has ${totalAllocated} hours allocated across ${activejobs.length} active jobs (max recommended: ${37.5 * 4})`,
                threshold: 37.5 * 4,
                current_value: totalAllocated,
                triggered_at: new Date(),
                recommendation: 'Consider reassigning jobs or extending timelines'
            });
        } else if (totalAllocated > 37.5 * 2) {
            alerts.push({
                alert_id: `HEAVILY_ALLOCATED_${technicianId}_${Date.now()}`,
                type: 'HEAVILY_ALLOCATED',
                severity: 'HIGH',
                title: 'Technician Heavily Allocated',
                description: `Technician has ${totalAllocated.toFixed(2)} hours allocated (above comfortable level)`,
                threshold: 37.5 * 3,
                current_value: totalAllocated,
                triggered_at: new Date(),
                recommendation: 'Monitor progress closely to ensure quality'
            });
        }

        // Check for excessive downtime
        const downtimeLogs = await DowntimeLog.find({
            supervisor_key: supervisorKey,
            technician_id: technicianId,
            date: { $gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) }
        });

        const totalDowntime = downtimeLogs.reduce((sum, log) => sum + log.total_downtime_hours, 0);

        if (totalDowntime > 5) {
            alerts.push({
                alert_id: `EXCESSIVE_DOWNTIME_${technicianId}_${Date.now()}`,
                type: 'EXCESSIVE_DOWNTIME',
                severity: 'HIGH',
                title: 'Excessive Downtime',
                description: `Technician has ${totalDowntime.toFixed(2)} hours of downtime in the past week`,
                threshold: 5,
                current_value: totalDowntime,
                triggered_at: new Date(),
                recommendation: 'Investigate root causes of downtime and address them'
            });
        }

        // Check for excessive overtime
        const overtimeLogs = await OvertimeLog.find({
            supervisor_key: supervisorKey,
            technician_id: technicianId,
            date: { $gte: weekStart, $lt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) }
        });

        const totalOvertime = overtimeLogs.reduce((sum, log) => sum + log.overtime_hours, 0);

        if (totalOvertime > 10) {
            alerts.push({
                alert_id: `EXCESSIVE_OT_${technicianId}_${Date.now()}`,
                type: 'EXCESSIVE_OVERTIME',
                severity: 'HIGH',
                title: 'Excessive Overtime',
                description: `Technician logged ${totalOvertime.toFixed(2)} overtime hours this week (max recommended: 10)`,
                threshold: 10,
                current_value: totalOvertime,
                triggered_at: new Date(),
                recommendation: 'Monitor technician fatigue and workload'
            });
        }

        // Filter by severity
        let filteredAlerts = alerts;
        if (severity) {
            filteredAlerts = alerts.filter(a => a.severity === severity);
        }

        res.json({
            success: true,
            data: filteredAlerts,
            count: filteredAlerts.length,
            summary: {
                critical: alerts.filter(a => a.severity === 'CRITICAL').length,
                high: alerts.filter(a => a.severity === 'HIGH').length,
                medium: alerts.filter(a => a.severity === 'MEDIUM').length,
                low: alerts.filter(a => a.severity === 'LOW').length
            }
        });
    } catch (error) {
        console.error('Error fetching technician alerts:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all alerts for supervisor
router.get('/:supervisorKey/supervisor/alerts', requireAuth, async (req, res) => {
    try {
        const { supervisorKey } = req.params;
        const { severity } = req.query;

        const alerts = [];

        // Get all technicians in supervisor's team
        const dayEntries = await DayEntry.find({ supervisor_key: supervisorKey });
        const technicianIds = [...new Set(dayEntries.map(d => d.technician_id.toString()))];

        // Check each technician for alerts
        for (const techId of technicianIds) {
            // Check utilization
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

            const weekDayEntries = await DayEntry.find({
                supervisor_key: supervisorKey,
                technician_id: techId,
                date: { $gte: weekStart, $lt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) }
            });

            let weeklyProductive = 0;
            let weeklyAvailable = 0;

            weekDayEntries.forEach(entry => {
                weeklyProductive += entry.total_productive_hours || 0;
                weeklyAvailable += entry.available_productive_hours || 0;
            });

            const utilizationPercent = weeklyAvailable > 0 ? (weeklyProductive / weeklyAvailable) * 100 : 0;

            if (utilizationPercent < 30) {
                alerts.push({
                    alert_id: `LOW_UTIL_${techId}_${Date.now()}`,
                    type: 'LOW_UTILIZATION',
                    severity: 'MEDIUM',
                    technician_id: techId,
                    title: 'Low Technician Utilization',
                    description: `Technician (${techId}) has ${utilizationPercent.toFixed(2)}% utilization`,
                    current_value: utilizationPercent,
                    triggered_at: new Date()
                });
            }
        }

        // Check for jobs at risk
        const activejobs = await Job.find({
            supervisor_key: supervisorKey,
            status: { $in: ['active', 'in_progress'] }
        });

        for (const job of activejobs) {
            if (job.target_completion_date) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const targetDate = new Date(job.target_completion_date);
                targetDate.setHours(0, 0, 0, 0);

                const daysRemaining = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));

                if (daysRemaining < 0) {
                    alerts.push({
                        alert_id: `OVERDUE_JOB_${job._id}_${Date.now()}`,
                        type: 'JOB_OVERDUE',
                        severity: 'CRITICAL',
                        job_id: job._id,
                        job_number: job.job_number,
                        title: 'Job Overdue',
                        description: `Job ${job.job_number} is ${Math.abs(daysRemaining)} days overdue`,
                        triggered_at: new Date()
                    });
                } else if (daysRemaining <= 5) {
                    alerts.push({
                        alert_id: `DEADLINE_APPROACHING_${job._id}_${Date.now()}`,
                        type: 'DEADLINE_APPROACHING',
                        severity: 'HIGH',
                        job_id: job._id,
                        job_number: job.job_number,
                        title: 'Job Deadline Approaching',
                        description: `Job ${job.job_number} deadline is in ${daysRemaining} days`,
                        triggered_at: new Date()
                    });
                }
            }
        }

        // Filter by severity
        let filteredAlerts = alerts;
        if (severity) {
            filteredAlerts = alerts.filter(a => a.severity === severity);
        }

        res.json({
            success: true,
            data: filteredAlerts,
            count: filteredAlerts.length,
            summary: {
                critical: alerts.filter(a => a.severity === 'CRITICAL').length,
                high: alerts.filter(a => a.severity === 'HIGH').length,
                medium: alerts.filter(a => a.severity === 'MEDIUM').length,
                low: alerts.filter(a => a.severity === 'LOW').length
            }
        });
    } catch (error) {
        console.error('Error fetching supervisor alerts:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
