const express = require('express');
const router = express.Router();
const Technician = require('../models/Technician');

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Technician login
router.post('/technician/login', async (req, res) => {
    try {
        const rawName = req.body?.name;
        const rawEmployeeId = req.body?.employee_id;

        const name = typeof rawName === 'string' ? rawName.trim() : '';
        const employee_id = String(rawEmployeeId ?? '').trim();

        if (!name || !employee_id) {
            return res.status(400).json({ error: 'name and employee_id are required' });
        }

        const technician = await Technician.findOne({
            name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
            employee_id: new RegExp(`^${escapeRegex(employee_id)}$`, 'i'),
            $or: [
                { status: 'active' },
                { status: { $exists: false } }
            ]
        });

        if (!technician) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.user = {
            type: 'technician',
            id: technician._id.toString(),
            name: technician.name,
            employee_id: technician.employee_id,
            department: technician.department
        };

        res.json({ user: req.session.user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Supervisor login
router.post('/supervisor/login', async (req, res) => {
    try {
        const { code } = req.body;
        
        if (code !== 'Epiroc#26') {
            return res.status(401).json({ error: 'Invalid supervisor code' });
        }

        req.session.user = {
            type: 'supervisor',
            name: 'Supervisor'
        };

        res.json({ user: req.session.user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get current user
router.get('/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ user: req.session.user });
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

module.exports = router;