const express = require('express');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth.routes');
const technicianRoutes = require('./routes/technician.routes');
const jobRoutes = require('./routes/job.routes');
const timeEntryRoutes = require('./routes/timeEntry.routes');
const enhancedTimeEntryRoutes = require('./routes/enhancedTimeEntry.routes');
const jobReportRoutes = require('./routes/jobReport.routes');
const archiveRoutes = require('./routes/archive.routes');
const overviewRoutes = require('./routes/overview.routes');
const utilizationRoutes = require('./routes/utilization.routes');
const pauseResumeRoutes = require('./routes/pauseResume.routes');
const trainingRoutes = require('./routes/training.routes');
const overtimeRoutes = require('./routes/overtime.routes');
const kpiRoutes = require('./routes/kpi.routes');
const jobManagementRoutes = require('./routes/job.management.routes');
const reportRoutes = require('./routes/reports.routes');
const alertRoutes = require('./routes/alerts.routes');
const systemFixesRoutes = require('./routes/system-fixes.routes');
const attendanceRoutes = require('./routes/attendance.routes');

const app = express();
app.set("trust proxy", 1); // required for cookies behind Render proxy

// Connect to Database
connectDB();

// ------------------------
// CORS Middleware
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://localhost:5178",
  "http://localhost:5179",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5176",
  "http://127.0.0.1:5177",
  "http://127.0.0.1:5178",
  "http://127.0.0.1:5179",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2,
  "https://labour-utilization.onrender.com"
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow Postman/curl or same-origin requests (no origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("Blocked CORS request from:", origin);
    return callback(new Error("CORS not allowed from this origin"));
  },
  credentials: true // allow cookies to be sent
}));

// ------------------------
// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
const isRender = Boolean(
  process.env.RENDER ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.RENDER_SERVICE_URL
);
const useCrossSiteCookies = isRender || process.env.NODE_ENV === "production";

app.use(session({
  secret: process.env.SESSION_SECRET || "epiroc-workshop-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: useCrossSiteCookies,           // must be true for SameSite=None
    sameSite: useCrossSiteCookies ? "none" : "lax", // allow cross-site cookies
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ------------------------
// Routes
app.use("/api/auth", authRoutes);
app.use("/api/technicians", technicianRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/time-entries", timeEntryRoutes);
app.use("/api/enhanced-time-entries", enhancedTimeEntryRoutes);
app.use("/api/job-reports", jobReportRoutes);
app.use("/api/archives", archiveRoutes);
app.use("/api/overview", overviewRoutes);
app.use("/api/metrics", utilizationRoutes);

// Mount additional feature routes
app.use("/api/pause-resume", pauseResumeRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/overtime", overtimeRoutes);
app.use("/api/kpi", kpiRoutes);
app.use("/api/job-management", jobManagementRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/system-fixes", systemFixesRoutes);
app.use("/api/attendance", attendanceRoutes);

// Add cross-supervisor job fix route
const fixCrossSupervisorJobsRoutes = require('./routes/fixCrossSupervisorJobs.routes');
app.use("/api/fix", fixCrossSupervisorJobsRoutes);

// Add existing job fix route
const fixExistingJobRoutes = require('./routes/fixExistingJob');
app.use("/api/fix-existing-job", fixExistingJobRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: process.env.NODE_ENV === "production" ? undefined : err.message
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
