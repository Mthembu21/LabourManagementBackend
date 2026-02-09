const express = require('express');
const router = express.Router();
const Technician = require('../models/Technician');
const DailyTimeEntry = require('../models/DailyTimeEntry');
const { requireSupervisor } = require('../middleware/auth');

// Get all technicians
router.get('/', async (req, res) => {
    try {
        const technicians = await Technician.find().sort({ createdAt: -1 });
        res.json(technicians);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create technician
router.post('/', requireSupervisor, async (req, res) => {
    try {
        const technician = new Technician(req.body);
        await technician.save();
        res.status(201).json(technician);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete technician (and their time entries)
router.delete('/:id', requireSupervisor, async (req, res) => {
    try {
        await DailyTimeEntry.deleteMany({ technician_id: req.params.id });
        await Technician.findByIdAndDelete(req.params.id);
        res.json({ message: 'Technician and time entries deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;