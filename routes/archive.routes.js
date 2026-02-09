const express = require('express');
const router = express.Router();
const MonthlyArchive = require('../models/MonthlyArchive');
const DailyTimeEntry = require('../models/DailyTimeEntry');
const { requireSupervisor } = require('../middleware/auth');

// Get all archives
router.get('/', requireSupervisor, async (req, res) => {
    try {
        const archives = await MonthlyArchive.find().sort({ start_date: -1 });
        res.json(archives);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create archive and delete time entries
router.post('/', requireSupervisor, async (req, res) => {
    try {
        const archive = new MonthlyArchive(req.body);
        await archive.save();
        await DailyTimeEntry.deleteMany({});
        res.status(201).json(archive);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;