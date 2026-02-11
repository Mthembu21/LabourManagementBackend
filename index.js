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


const express = require('express');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth.routes');
const technicianRoutes = require('./routes/technician.routes');
const jobRoutes = require('./routes/job.routes');
const timeEntryRoutes = require('./routes/timeEntry.routes');
const jobReportRoutes = require('./routes/jobReport.routes');
const archiveRoutes = require('./routes/archive.routes');

const app = express();

// Connect to Database
connectDB();

// ------------------------
// CORS Middleware
// Allow multiple dev ports + production frontend
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5175',
    'http://localhost:5176',
    'https://your-production-frontend.com' // <-- replace with your deployed frontend URL
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true); // allow requests from Postman/curl
        if (!allowedOrigins.includes(origin)) {
            return callback(new Error('CORS not allowed from this origin'), false);
        }
        return callback(null, true);
    },
    credentials: true // allow cookies/auth headers
}));
// ------------------------

// Parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'epiroc-workshop-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/technicians', technicianRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/job-reports', jobReportRoutes);
app.use('/api/archives', archiveRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
