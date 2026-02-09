const express = require('express');
const router = express.Router();
const Technician = require('../models/Technician');

// Technician login
router.post('/technician/login', async (req, res) => {
    try {
        const { name, employee_id } = req.body;
        
        const technician = await Technician.findOne({
            name: new RegExp(`^${name}$`, 'i'),
            employee_id: employee_id
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