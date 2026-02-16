// const express = require('express');
// const session = require('express-session');
// const cors = require('cors');
// require('dotenv').config();

// const connectDB = require('./config/database');
// const authRoutes = require('./routes/auth.routes');
// const technicianRoutes = require('./routes/technician.routes');
// const jobRoutes = require('./routes/job.routes');
// const timeEntryRoutes = require('./routes/timeEntry.routes');
// const jobReportRoutes = require('./routes/jobReport.routes');
// const archiveRoutes = require('./routes/archive.routes');

// const app = express();

// // Connect to Database
// connectDB();

// // Middleware
// app.use(cors({
//     origin: process.env.FRONTEND_URL || 'http://localhost:5173',
//     credentials: true
// }));
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Session configuration
// app.use(session({
//     secret: process.env.SESSION_SECRET || 'epiroc-workshop-secret',
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//         secure: process.env.NODE_ENV === 'production',
//         httpOnly: true,
//         maxAge: 24 * 60 * 60 * 1000 // 24 hours
//     }
// }));

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/technicians', technicianRoutes);
// app.use('/api/jobs', jobRoutes);
// app.use('/api/time-entries', timeEntryRoutes);
// app.use('/api/job-reports', jobReportRoutes);
// app.use('/api/archives', archiveRoutes);

// // Health check
// app.get('/api/health', (req, res) => {
//     res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// // Error handler
// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({ 
//         error: 'Something went wrong!',
//         message: process.env.NODE_ENV === 'development' ? err.message : undefined
//     });
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });


// const express = require('express');
// const session = require('express-session');
// const cors = require('cors');
// require('dotenv').config();

// const connectDB = require('./config/database');
// const authRoutes = require('./routes/auth.routes');
// const technicianRoutes = require('./routes/technician.routes');
// const jobRoutes = require('./routes/job.routes');
// const timeEntryRoutes = require('./routes/timeEntry.routes');
// const jobReportRoutes = require('./routes/jobReport.routes');
// const archiveRoutes = require('./routes/archive.routes');

// const app = express();

// app.set('trust proxy', 1);

// // Connect to Database
// connectDB();

// // ------------------------
// // CORS Middleware
// // Allow multiple dev ports + production frontend
// const allowedOrigins = [
//     'http://localhost:5173',
//     'http://localhost:5175',
//     'http://localhost:5176',
//     process.env.FRONTEND_URL,
//     'https://your-production-frontend.com' // <-- replace with your deployed frontend URL
// ].filter(Boolean);

// const isLocalhostOrigin = (origin) => {
//     try {
//         const u = new URL(origin);
//         return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
//     } catch {
//         return false;
//     }
// };

// app.use(cors({
//     origin: function(origin, callback) {
//         if (!origin) return callback(null, true); // allow requests from Postman/curl
//         if (!allowedOrigins.includes(origin) && !isLocalhostOrigin(origin)) {
//             return callback(new Error('CORS not allowed from this origin'), false);
//         }
//         return callback(null, true);
//     },
//     credentials: true // allow cookies/auth headers
// }));
// // ------------------------

// // Parse JSON and URL-encoded data
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Session configuration
// const useCrossSiteCookies = process.env.CROSS_SITE_COOKIES === 'true' || process.env.NODE_ENV === 'production';
// app.use(session({
//     secret: process.env.SESSION_SECRET || 'epiroc-workshop-secret',
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//         secure: useCrossSiteCookies,
//         sameSite: useCrossSiteCookies ? 'none' : 'lax',
//         httpOnly: true,
//         maxAge: 24 * 60 * 60 * 1000 // 24 hours
//     }
// }));

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/technicians', technicianRoutes);
// app.use('/api/jobs', jobRoutes);
// app.use('/api/time-entries', timeEntryRoutes);
// app.use('/api/job-reports', jobReportRoutes);
// app.use('/api/archives', archiveRoutes);

// // Health check
// app.get('/api/health', (req, res) => {
//     res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// // Error handler
// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({ 
//         error: 'Something went wrong!',
//         message: process.env.NODE_ENV === 'development' ? err.message : undefined
//     });
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
//});


// 


// const express = require('express');
// const session = require('express-session');
// const cors = require('cors');
// require('dotenv').config();

// const connectDB = require('./config/database');
// const authRoutes = require('./routes/auth.routes');
// const technicianRoutes = require('./routes/technician.routes');
// const jobRoutes = require('./routes/job.routes');
// const timeEntryRoutes = require('./routes/timeEntry.routes');
// const jobReportRoutes = require('./routes/jobReport.routes');
// const archiveRoutes = require('./routes/archive.routes');

// const app = express();

// app.set('trust proxy', 1); // required for cookies behind Render proxy

// // Connect to Database
// connectDB();

// // ------------------------
// // CORS Middleware
// const allowedOrigins = [
//     'http://localhost:5173',
//     'http://localhost:5175',
//     'http://localhost:5176',
//     process.env.FRONTEND_URL // your deployed frontend URL from Render env vars
// ].filter(Boolean);

// app.use(cors({
//     origin: function(origin, callback) {
//         // Allow Postman/curl or same-origin requests (no origin)
//         if (!origin) return callback(null, true);

//         // Check if origin is allowed
//         if (allowedOrigins.includes(origin)) {
//             return callback(null, true);
//         }

//         console.log('Blocked CORS request from:', origin);
//         return callback(new Error('CORS not allowed from this origin'));
//     },
//     credentials: true // allow cookies to be sent
// }));

// // ------------------------
// // Parse JSON
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Session configuration
// const isProduction = process.env.NODE_ENV === 'production';
// app.use(session({
//     secret: process.env.SESSION_SECRET || 'epiroc-workshop-secret',
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//         secure: isProduction,          // true in production (HTTPS)
//         sameSite: isProduction ? 'none' : 'lax', // allow cross-site cookies
//         httpOnly: true,
//         maxAge: 24 * 60 * 60 * 1000 // 24 hours
//     }
// }));

// // ------------------------
// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/technicians', technicianRoutes);
// app.use('/api/jobs', jobRoutes);
// app.use('/api/time-entries', timeEntryRoutes);
// app.use('/api/job-reports', jobReportRoutes);
// app.use('/api/archives', archiveRoutes);

// // Health check
// app.get('/api/health', (req, res) => {
//     res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// // Error handler
// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({
//         error: 'Something went wrong!',
//         message: isProduction ? undefined : err.message
//     });
// });

// // Start server
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });



// const express = require('express');
// const session = require('express-session');
// const cors = require('cors');
// require('dotenv').config();

// const connectDB = require('./config/database');
// const authRoutes = require('./routes/auth.routes');
// const technicianRoutes = require('./routes/technician.routes');
// const jobRoutes = require('./routes/job.routes');
// const timeEntryRoutes = require('./routes/timeEntry.routes');
// const jobReportRoutes = require('./routes/jobReport.routes');
// const archiveRoutes = require('./routes/archive.routes');

// const app = express();

// // Required for secure cookies behind Render proxy
// app.set('trust proxy', 1);

// // Connect to MongoDB
// connectDB();


// // ==============================
// // ✅ SIMPLE CORS CONFIG (PRODUCTION SAFE)
// // ==============================
// app.use(cors({
//     origin: 'https://labour-utilization.onrender.com', // your frontend URL
//     credentials: true
// }));


// // ==============================
// // BODY PARSING
// // ==============================
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));


// // ==============================
// // SESSION CONFIG
// // ==============================
// const isProduction = process.env.NODE_ENV === 'production';

// app.use(session({
//     secret: process.env.SESSION_SECRET || 'epiroc-workshop-secret',
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//         secure: isProduction,              // true in production (Render uses HTTPS)
//         sameSite: isProduction ? 'none' : 'lax', // required for cross-site cookies
//         httpOnly: true,
//         maxAge: 24 * 60 * 60 * 1000 // 24 hours
//     }
// }));


// // ==============================
// // ROUTES
// // ==============================
// app.use('/api/auth', authRoutes);
// app.use('/api/technicians', technicianRoutes);
// app.use('/api/jobs', jobRoutes);
// app.use('/api/time-entries', timeEntryRoutes);
// app.use('/api/job-reports', jobReportRoutes);
// app.use('/api/archives', archiveRoutes);


// // ==============================
// // HEALTH CHECK
// // ==============================
// app.get('/api/health', (req, res) => {
//     res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });


// // ==============================
// // ERROR HANDLER
// // ==============================
// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({
//         error: 'Something went wrong!',
//         message: isProduction ? undefined : err.message
//     });
// });


// // ==============================
// // START SERVER
// // ==============================
// const PORT = process.env.PORT || 5000;

// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
// });


const express = require("express");
const session = require("express-session");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/database");
const authRoutes = require("./routes/auth.routes");
const technicianRoutes = require("./routes/technician.routes");
const jobRoutes = require("./routes/job.routes");
const timeEntryRoutes = require("./routes/timeEntry.routes");
const jobReportRoutes = require("./routes/jobReport.routes");
const archiveRoutes = require("./routes/archive.routes");

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
const isProduction = process.env.NODE_ENV === "production";
app.use(session({
  secret: process.env.SESSION_SECRET || "epiroc-workshop-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,           // true in production (HTTPS)
    sameSite: isProduction ? "none" : "lax", // allow cross-site cookies
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
app.use("/api/job-reports", jobReportRoutes);
app.use("/api/archives", archiveRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: isProduction ? undefined : err.message
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
