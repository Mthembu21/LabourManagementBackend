const express = require('express');
const router = express.Router();
const Technician = require('../models/Technician');
const Supervisor = require('../models/Supervisor');
const bcrypt = require('bcryptjs');

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmail(rawEmail) {
    return typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
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
            department: technician.department,
            supervisor_key: technician.supervisor_key || 'component'
        };

        res.json({ user: req.session.user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

let supervisorsSeeded = false;
async function ensureSupervisorsSeeded() {
    if (supervisorsSeeded) return;

    const seeds = [
        {
            supervisor_key: 'component',
            email: 'given.theka@epiroc.com',
            password: '123'
        },
        {
            supervisor_key: 'rebuild',
            email: 'sibonele.moyo@epiroc.com',
            password: '456'
        },
        {
            supervisor_key: 'pdis',
            email: 'leah.mcluskey@epiroc.com',
            password: '789'
        }
    ];

    for (const s of seeds) {
        const seedEmail = normalizeEmail(s.email);
        const existing = await Supervisor.findOne({
            email: new RegExp(`^${escapeRegex(seedEmail)}$`, 'i')
        });

        const password_hash = await bcrypt.hash(s.password, 10);

        if (!existing) {
            await Supervisor.create({
                supervisor_key: s.supervisor_key,
                email: seedEmail,
                password_hash
            });
            continue;
        }

        // Self-heal seeded accounts (prod-safe for these temporary seeded credentials)
        let needsSave = false;
        if (existing.email !== seedEmail) {
            existing.email = seedEmail;
            needsSave = true;
        }
        if (existing.supervisor_key !== s.supervisor_key) {
            existing.supervisor_key = s.supervisor_key;
            needsSave = true;
        }
        if (existing.password_hash !== password_hash) {
            existing.password_hash = password_hash;
            needsSave = true;
        }
        if (needsSave) await existing.save();
    }

    supervisorsSeeded = true;
}

// Supervisor login
router.post('/supervisor/login', async (req, res) => {
    try {
        await ensureSupervisorsSeeded();

        const rawEmail = req.body?.email;
        const rawPassword = req.body?.password;
        const email = normalizeEmail(rawEmail);
        const password = typeof rawPassword === 'string' ? rawPassword : '';

        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        const supervisor = await Supervisor.findOne({
            email: new RegExp(`^${escapeRegex(email)}$`, 'i')
        });
        if (!supervisor) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const ok = await bcrypt.compare(password, supervisor.password_hash);
        if (!ok) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.session.user = {
            type: 'supervisor',
            id: supervisor._id.toString(),
            email: supervisor.email,
            supervisor_key: supervisor.supervisor_key
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