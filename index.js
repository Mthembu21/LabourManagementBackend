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

const app = express();
app.set("trust proxy", 1); // required for cookies behind Render proxy

// Connect to Database
connectDB();

// ------------------------
// CORS Middleware
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5176",
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
