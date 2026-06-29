/**
 * Phase 3-4 API Integration Guide
 * Register all routes in main index.js or app.js
 */

// ============================================
// PHASE 3: JOB MANAGEMENT API ROUTES
// ============================================

// Job Status & Management
// const jobManagementRoutes = require('./routes/job.management.routes');
// app.use('/api/job-management', jobManagementRoutes);

/**
 * Endpoints:
 * 
 * GET  /api/job-management/:supervisorKey/active
 *   Get all active jobs for technician or supervisor
 *   Query params: technician_id (optional)
 *   Response: { success, data: [jobs...] }
 * 
 * GET  /api/job-management/:supervisorKey/completed
 *   Get all completed jobs
 *   Query params: start_date, end_date, technician_id (optional)
 *   Response: { success, data: [jobs...] }
 * 
 * GET  /api/job-management/:supervisorKey/at-risk
 *   Get jobs flagged as at-risk (Orange/Red)
 *   Query params: status (ACTIVE/ALL), risk_level (GREEN/ORANGE/RED)
 *   Response: { success, data: [jobs...] }
 * 
 * POST /api/job-management/:supervisorKey/update-risk/:jobId
 *   Manually trigger risk recalculation for a job
 *   Body: {} (triggers automatic calculation)
 *   Response: { success, data: { job_id, risk_level, risk_score } }
 * 
 * GET  /api/job-management/:supervisorKey/validate-capacity
 *   Validate capacity before assigning work
 *   Query params: technician_id, estimated_hours, duration_weeks
 *   Response: { success, can_allocate: boolean, available_capacity: X, reason: string }
 * 
 * GET  /api/job-management/:supervisorKey/complexity-distribution
 *   Get distribution of jobs by complexity category
 *   Query params: status (ACTIVE/COMPLETED/ALL)
 *   Response: { success, data: { low: X, medium: Y, high: Z, critical: W } }
 * 
 * GET  /api/job-management/:supervisorKey/job/:jobId/report
 *   Get current job status and performance report
 *   Response: { success, data: { job_details, technician_breakdown, timeline, risk_assessment } }
 * 
 * POST /api/job-management/:supervisorKey/job/:jobId/update-status
 *   Update job status (active -> completed, etc.)
 *   Body: { status: "completed", notes: "..." }
 *   Response: { success, data: updated_job }
 * 
 * GET  /api/job-management/:supervisorKey/workload-summary
 *   Get team workload distribution
 *   Response: { success, data: [{ technician_id, total_allocated, active_jobs, utilization % }] }
 * 
 * GET  /api/job-management/:supervisorKey/technician/:techId/capacity
 *   Get remaining capacity for a technician
 *   Response: { success, data: { available_hours, allocated_hours, utilization_percent, status } }
 * 
 * POST /api/job-management/:supervisorKey/allocate-job/:jobId
 *   Allocate job to technician (with capacity validation)
 *   Body: { technician_id, allocated_hours, description }
 *   Response: { success, data: allocation, message }
 */


// ============================================
// PHASE 4: KPI & REPORTING API ROUTES
// ============================================

// KPI Calculations & Trending
// const kpiRoutes = require('./routes/kpi.routes');
// app.use('/api/kpi', kpiRoutes);

/**
 * Endpoints:
 * 
 * GET  /api/kpi/:supervisorKey/technician/:techId/day/:date
 *   Daily KPIs for a technician
 *   Response: { success, data: { date, kpis: { availability %, productive %, ... }, hours_breakdown } }
 * 
 * GET  /api/kpi/:supervisorKey/technician/:techId/week/:weekNum/:year
 *   Weekly KPIs and aggregates
 *   Response: { success, data: { week_number, year, kpis, daily_breakdown } }
 * 
 * GET  /api/kpi/:supervisorKey/technician/:techId/month/:month/:year
 *   Monthly KPIs
 *   Response: { success, data: { month, year, kpis, weekly_breakdown } }
 * 
 * GET  /api/kpi/:supervisorKey/dashboard/overview
 *   Get all KPIs for dashboard (supervisor/planner/pm level)
 *   Query params: view_type (daily/weekly/monthly)
 *   Response: { success, data: { kpis_cards: { productive %, idle %, ... }, active_jobs, completed_jobs, jobs_at_risk, overtime_hours } }
 * 
 * GET  /api/kpi/:supervisorKey/trends/utilization
 *   Historical utilization trending
 *   Query params: period (7d/30d/90d), technician_id (optional)
 *   Response: { success, data: { trend_data: [{ date, utilization % }] } }
 * 
 * GET  /api/kpi/:supervisorKey/trends/overtime
 *   Historical overtime trending
 *   Query params: period (7d/30d/90d), technician_id (optional)
 *   Response: { success, data: { trend_data: [{ date, overtime_hours }] } }
 * 
 * Note: Other trend endpoints (productivity, efficiency, etc.) follow same pattern
 */


// ============================================
// PHASE 4: REPORTING API ROUTES
// ============================================

// Reports & Analytics
// const reportRoutes = require('./routes/reports.routes');
// app.use('/api/reports', reportRoutes);

/**
 * Endpoints:
 * 
 * GET  /api/reports/:supervisorKey/job/:jobId/completion
 *   Detailed completed job report
 *   Response: { success, data: { job_details, hours_breakdown, performance_metrics, technician_details } }
 * 
 * GET  /api/reports/:supervisorKey/technician/:techId/performance
 *   Technician performance report (time period)
 *   Query params: start_date, end_date
 *   Response: { success, data: { hours_summary, kpis, activity_summary, training_details } }
 * 
 * GET  /api/reports/:supervisorKey/performance-summary
 *   Supervisor team performance summary
 *   Query params: start_date, end_date
 *   Response: { success, data: { team_metrics, hours_breakdown, kpis, job_metrics } }
 */


// ============================================
// PHASE 4: ALERTS API ROUTES
// ============================================

// Alerts & Monitoring
// const alertsRoutes = require('./routes/alerts.routes');
// app.use('/api/alerts', alertsRoutes);

/**
 * Endpoints:
 * 
 * GET  /api/alerts/:supervisorKey/technician/:techId/alerts
 *   Get all active alerts for technician
 *   Query params: severity (LOW/MEDIUM/HIGH/CRITICAL - optional)
 *   Response: { success, data: [alerts...], count, summary: { critical, high, medium, low } }
 *   
 *   Alert Types:
 *   - LOW_UTILIZATION (< 30%)
 *   - MEDIUM_UTILIZATION (30-60%)
 *   - OVERALLOCATED (> 4 weeks @ 37.5 hrs/week)
 *   - HEAVILY_ALLOCATED (> 2 weeks allocation)
 *   - EXCESSIVE_DOWNTIME (> 5 hours/week)
 *   - EXCESSIVE_OVERTIME (> 10 hours/week)
 * 
 * GET  /api/alerts/:supervisorKey/supervisor/alerts
 *   Get all alerts affecting the supervisor's team
 *   Query params: severity (optional)
 *   Response: { success, data: [alerts...], count, summary }
 *   
 *   Alert Types:
 *   - LOW_UTILIZATION (technician level)
 *   - JOB_OVERDUE (past target date)
 *   - DEADLINE_APPROACHING (< 5 days to deadline)
 */


// ============================================
// INTEGRATION CHECKLIST
// ============================================

/**
 * To complete Phase 3-4 integration:
 * 
 * 1. In main index.js or app.js file:
 *    
 *    const jobManagementRoutes = require('./routes/job.management.routes');
 *    const kpiRoutes = require('./routes/kpi.routes');
 *    const reportRoutes = require('./routes/reports.routes');
 *    const alertsRoutes = require('./routes/alerts.routes');
 *    
 *    app.use('/api/job-management', jobManagementRoutes);
 *    app.use('/api/kpi', kpiRoutes);
 *    app.use('/api/reports', reportRoutes);
 *    app.use('/api/alerts', alertsRoutes);
 * 
 * 2. Verify middleware:
 *    - requireAuth middleware must be properly implemented
 *    - supervisorKey extraction from request
 * 
 * 3. Test all endpoints with curl or Postman:
 *    - Each endpoint listed above
 *    - Verify response formats
 *    - Check error handling
 * 
 * 4. Performance optimization (if needed):
 *    - Add caching for KPI calculations (Redis recommended)
 *    - Add database query indexing
 *    - Implement pagination for large result sets
 */

module.exports = {
    PHASE_3_ENDPOINTS: [
        'GET  /api/job-management/:supervisorKey/active',
        'GET  /api/job-management/:supervisorKey/completed',
        'GET  /api/job-management/:supervisorKey/at-risk',
        'POST /api/job-management/:supervisorKey/update-risk/:jobId',
        'GET  /api/job-management/:supervisorKey/validate-capacity',
        'GET  /api/job-management/:supervisorKey/complexity-distribution',
        'GET  /api/job-management/:supervisorKey/job/:jobId/report',
        'POST /api/job-management/:supervisorKey/job/:jobId/update-status',
        'GET  /api/job-management/:supervisorKey/workload-summary',
        'GET  /api/job-management/:supervisorKey/technician/:techId/capacity',
        'POST /api/job-management/:supervisorKey/allocate-job/:jobId'
    ],
    PHASE_4_KPI_ENDPOINTS: [
        'GET  /api/kpi/:supervisorKey/technician/:techId/day/:date',
        'GET  /api/kpi/:supervisorKey/technician/:techId/week/:weekNum/:year',
        'GET  /api/kpi/:supervisorKey/technician/:techId/month/:month/:year',
        'GET  /api/kpi/:supervisorKey/dashboard/overview',
        'GET  /api/kpi/:supervisorKey/trends/utilization',
        'GET  /api/kpi/:supervisorKey/trends/overtime'
    ],
    PHASE_4_REPORTS_ENDPOINTS: [
        'GET  /api/reports/:supervisorKey/job/:jobId/completion',
        'GET  /api/reports/:supervisorKey/technician/:techId/performance',
        'GET  /api/reports/:supervisorKey/performance-summary'
    ],
    PHASE_4_ALERTS_ENDPOINTS: [
        'GET  /api/alerts/:supervisorKey/technician/:techId/alerts',
        'GET  /api/alerts/:supervisorKey/supervisor/alerts'
    ]
};
