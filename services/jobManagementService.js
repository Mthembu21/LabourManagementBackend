/**
 * Job Management Service - Phase 3
 * Handles job status tracking, capacity validation, and Jobs at Risk logic
 */

const Job = require('../models/Job');
const DayEntry = require('../models/DayEntry');
const Technician = require('../models/Technician');

class JobManagementService {
    /**
     * Calculate job risk level based on multiple factors
     * Risk Levels:
     * - GREEN: On Track (0-80% of time used, target date not approaching)
     * - ORANGE: At Risk (80-100% of time used OR target date within 5 days)
     * - RED: Overdue (Over allocated OR past target date)
     */
    static async calculateJobRisk(jobId) {
        try {
            const job = await Job.findById(jobId).populate('technicians.technician_id');
            if (!job) {
                return { error: 'Job not found' };
            }

            const {
                allocated_hours,
                consumed_hours,
                target_completion_date,
                status,
                technical_complexity_hours
            } = job;

            let riskLevel = 'GREEN';
            let riskScore = 0;
            const factors = [];

            // Factor 1: Allocation utilization
            if (allocated_hours > 0) {
                const utilizationPercent = (consumed_hours / allocated_hours) * 100;

                if (utilizationPercent > 100) {
                    riskLevel = 'RED';
                    riskScore += 50;
                    factors.push({
                        factor: 'Over-allocated',
                        severity: 'CRITICAL',
                        utilization_percent: utilizationPercent,
                        allocated: allocated_hours,
                        consumed: consumed_hours
                    });
                } else if (utilizationPercent > 80) {
                    if (riskLevel !== 'RED') riskLevel = 'ORANGE';
                    riskScore += 25;
                    factors.push({
                        factor: 'High utilization',
                        severity: 'HIGH',
                        utilization_percent: utilizationPercent
                    });
                } else if (utilizationPercent > 60) {
                    riskScore += 10;
                    factors.push({
                        factor: 'Medium utilization',
                        severity: 'MEDIUM',
                        utilization_percent: utilizationPercent
                    });
                }
            }

            // Factor 2: Target date proximity
            if (target_completion_date) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const targetDate = new Date(target_completion_date);
                targetDate.setHours(0, 0, 0, 0);

                const daysRemaining = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));

                if (daysRemaining < 0) {
                    riskLevel = 'RED';
                    riskScore += 40;
                    factors.push({
                        factor: 'Overdue',
                        severity: 'CRITICAL',
                        days_overdue: Math.abs(daysRemaining),
                        target_date: target_completion_date
                    });
                } else if (daysRemaining <= 5) {
                    if (riskLevel !== 'RED') riskLevel = 'ORANGE';
                    riskScore += 20;
                    factors.push({
                        factor: 'Approaching deadline',
                        severity: 'HIGH',
                        days_remaining: daysRemaining,
                        target_date: target_completion_date
                    });
                } else if (daysRemaining <= 10) {
                    riskScore += 10;
                    factors.push({
                        factor: 'Moderate deadline',
                        severity: 'MEDIUM',
                        days_remaining: daysRemaining
                    });
                }
            }

            // Factor 3: Technician capacity
            if (job.technicians && job.technicians.length > 0) {
                const techCapacityIssues = await this._checkTechnicianCapacity(job);
                if (techCapacityIssues.length > 0) {
                    if (riskLevel === 'GREEN') riskLevel = 'ORANGE';
                    riskScore += 15;
                    factors.push({
                        factor: 'Technician capacity',
                        severity: 'HIGH',
                        issues: techCapacityIssues
                    });
                }
            }

            // Factor 4: Complexity hours
            if (technical_complexity_hours > allocated_hours * 0.5) {
                riskScore += 10;
                factors.push({
                    factor: 'High technical complexity',
                    severity: 'MEDIUM',
                    complexity_hours: technical_complexity_hours,
                    allocated_hours
                });
            }

            // Determine if status needs update
            let shouldUpdateStatus = false;
            let newStatus = status;

            if (riskLevel === 'RED' && status !== 'at_risk') {
                newStatus = 'at_risk';
                shouldUpdateStatus = true;
            } else if (riskLevel === 'ORANGE' && !['at_risk', 'over_allocated', 'overrun'].includes(status)) {
                newStatus = 'at_risk';
                shouldUpdateStatus = true;
            }

            return {
                job_id: jobId,
                risk_level: riskLevel,
                risk_score: riskScore,
                factors,
                status_recommendation: newStatus,
                should_update_status: shouldUpdateStatus,
                utilization_percent: allocated_hours > 0 ? ((consumed_hours / allocated_hours) * 100).toFixed(2) : 0
            };
        } catch (error) {
            console.error('Error calculating job risk:', error);
            throw error;
        }
    }

    /**
     * Get all jobs at risk for a supervisor
     */
    static async getJobsAtRisk(supervisorKey, riskLevel = null) {
        try {
            const query = {
                supervisor_key: supervisorKey,
                status: { $in: ['active', 'in_progress', 'at_risk', 'over_allocated', 'overrun'] }
            };

            let jobs = await Job.find(query)
                .populate('technicians.technician_id', 'name employee_id')
                .sort({ target_completion_date: 1 });

            // Calculate risk for each job
            const jobsWithRisk = await Promise.all(
                jobs.map(async (job) => {
                    const risk = await this.calculateJobRisk(job._id);
                    return {
                        ...job.toObject(),
                        risk_assessment: risk
                    };
                })
            );

            // Filter by risk level if specified
            if (riskLevel) {
                return jobsWithRisk.filter(j => j.risk_assessment.risk_level === riskLevel);
            }

            // Sort by risk score (highest first)
            return jobsWithRisk.sort((a, b) => b.risk_assessment.risk_score - a.risk_assessment.risk_score);
        } catch (error) {
            console.error('Error getting jobs at risk:', error);
            throw error;
        }
    }

    /**
     * Check if technicians are over-allocated
     */
    static async _checkTechnicianCapacity(job) {
        const issues = [];

        for (const assignment of job.technicians) {
            const tech = assignment.technician_id;
            if (!tech) continue;

            // Get all active jobs for this technician
            const activejobs = await Job.find({
                supervisor_key: job.supervisor_key,
                'technicians.technician_id': tech._id,
                status: { $in: ['active', 'in_progress', 'at_risk'] },
                _id: { $ne: job._id }
            });

            // Calculate total allocated hours across all jobs
            const totalAllocated = activejobs.reduce((sum, j) => {
                const techAssignment = j.technicians.find(t => t.technician_id.toString() === tech._id.toString());
                return sum + (techAssignment?.allocated_hours || 0);
            }, 0) + (assignment.allocated_hours || 0);

            // Max productive hours per week: 35 (7*5 or 7+7+7+7+5.5)
            const maxProductivePerWeek = 37.5;

            if (totalAllocated > maxProductivePerWeek * 4) { // 4-week threshold
                issues.push({
                    technician_id: tech._id,
                    technician_name: tech.name,
                    total_allocated: totalAllocated,
                    max_recommended: maxProductivePerWeek * 4,
                    severity: 'OVERALLOCATED'
                });
            }
        }

        return issues;
    }

    /**
     * Get active jobs for technician
     */
    static async getTechnicianActiveJobs(supervisorKey, technicianId) {
        try {
            const jobs = await Job.find({
                supervisor_key: supervisorKey,
                'technicians.technician_id': technicianId,
                status: { $in: ['active', 'in_progress'] }
            })
            .populate('technicians.technician_id', 'name employee_id')
            .sort({ target_completion_date: 1 });

            // Enrich with risk assessment
            const jobsWithRisk = await Promise.all(
                jobs.map(async (job) => {
                    const risk = await this.calculateJobRisk(job._id);
                    return {
                        ...job.toObject(),
                        risk_assessment: risk
                    };
                })
            );

            return jobsWithRisk;
        } catch (error) {
            console.error('Error getting technician active jobs:', error);
            throw error;
        }
    }

    /**
     * Get completed jobs for reporting
     */
    static async getCompletedJobs(supervisorKey, startDate, endDate) {
        try {
            const query = {
                supervisor_key: supervisorKey,
                status: 'completed'
            };

            if (startDate || endDate) {
                query.actual_completion_date = {};
                if (startDate) query.actual_completion_date.$gte = new Date(startDate);
                if (endDate) query.actual_completion_date.$lte = new Date(endDate);
            }

            const jobs = await Job.find(query)
                .populate('technicians.technician_id', 'name employee_id')
                .sort({ actual_completion_date: -1 });

            return jobs.map(job => {
                const efficiency = job.allocated_hours > 0
                    ? ((job.consumed_hours / job.allocated_hours) * 100).toFixed(2)
                    : 0;

                return {
                    ...job.toObject(),
                    efficiency_percent: efficiency,
                    status: 'completed'
                };
            });
        } catch (error) {
            console.error('Error getting completed jobs:', error);
            throw error;
        }
    }

    /**
     * Validate job can be started (capacity check)
     */
    static async validateJobCapacity(supervisorKey, jobId, technicianIds) {
        try {
            const job = await Job.findById(jobId);
            if (!job) {
                return { valid: false, errors: ['Job not found'] };
            }

            const errors = [];

            for (const techId of technicianIds) {
                // Get technician's active jobs
                const activejobs = await Job.find({
                    supervisor_key: supervisorKey,
                    'technicians.technician_id': techId,
                    status: { $in: ['active', 'in_progress'] },
                    _id: { $ne: jobId }
                });

                // Get technician's day entries for this week
                const today = new Date();
                const weekStart = new Date(today);
                weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);

                const dayEntries = await DayEntry.find({
                    technician_id: techId,
                    date: { $gte: weekStart, $lt: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) }
                });

                // Calculate total productive hours this week
                const totalThisWeek = dayEntries.reduce((sum, de) => 
                    sum + (de.total_productive_hours || 0), 0
                );

                // Max is 37.5 hours per week
                if (totalThisWeek + job.allocated_hours > 37.5) {
                    errors.push({
                        technician_id: techId,
                        reason: 'Exceeds weekly capacity',
                        current_week_hours: totalThisWeek,
                        job_hours: job.allocated_hours,
                        max_capacity: 37.5
                    });
                }

                // Check technician capacity across all active jobs
                const totalAllocated = activejobs.reduce((sum, j) => {
                    const assignment = j.technicians.find(t => 
                        t.technician_id.toString() === techId.toString()
                    );
                    return sum + (assignment?.allocated_hours || 0);
                }, 0);

                if (totalAllocated + job.allocated_hours > 37.5 * 4) {
                    errors.push({
                        technician_id: techId,
                        reason: 'Over-allocated across jobs',
                        total_allocated: totalAllocated,
                        job_hours: job.allocated_hours,
                        max_recommendation: 37.5 * 4
                    });
                }
            }

            return {
                valid: errors.length === 0,
                errors: errors,
                job_id: jobId,
                capacity_check: {
                    max_weekly_hours: 37.5,
                    max_concurrent_jobs_allocation: 37.5 * 4
                }
            };
        } catch (error) {
            console.error('Error validating job capacity:', error);
            throw error;
        }
    }

    /**
     * Get job complexity distribution
     */
    static async getComplexityDistribution(supervisorKey) {
        try {
            const jobs = await Job.find({ supervisor_key: supervisorKey });

            const distribution = {
                Low: 0,
                Medium: 0,
                High: 0,
                Critical: 0
            };

            let totalAllocated = 0;
            let totalConsumed = 0;

            jobs.forEach(job => {
                const category = job.complexity_category || 'Medium';
                distribution[category] += 1;
                totalAllocated += job.allocated_hours || 0;
                totalConsumed += job.consumed_hours || 0;
            });

            return {
                distribution,
                total_jobs: jobs.length,
                total_allocated_hours: totalAllocated,
                total_consumed_hours: totalConsumed,
                average_efficiency_percent: totalAllocated > 0 
                    ? ((totalConsumed / totalAllocated) * 100).toFixed(2)
                    : 0
            };
        } catch (error) {
            console.error('Error getting complexity distribution:', error);
            throw error;
        }
    }
}

module.exports = JobManagementService;
