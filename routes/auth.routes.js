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
            password: '123',
            role: 'supervisor',
            access: ['components']
        },
        {
            supervisor_key: 'rebuild',
            email: 'sibonele.moyo@epiroc.com',
            password: '456',
            role: 'supervisor',
            access: ['rebuild']
        },
        {
            supervisor_key: 'pdis',
            email: 'leah.mcluskey@epiroc.com',
            password: '789',
            role: 'supervisor',
            access: ['pdi']
        },
        {
            supervisor_key: 'pdis',
            email: 'john.vanderberg@epiroc.com',
            password: '963',
            role: 'foreman',
            access: ['pdi', 'rebuild']
        },
        {
            supervisor_key: 'component',
            email: 'tsholofelo.moloto@epiroc.com',
            password: '852',
            role: 'manager',
            access: ['components', 'pdi', 'rebuild', 'workshop_overview']
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
                role: s.role || 'supervisor',
                access: Array.isArray(s.access) ? s.access : [],
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
        if ((existing.role || 'supervisor') !== (s.role || 'supervisor')) {
            existing.role = s.role || 'supervisor';
            needsSave = true;
        }
        const desiredAccess = Array.isArray(s.access) ? s.access : [];
        const existingAccess = Array.isArray(existing.access) ? existing.access : [];
        if (JSON.stringify(existingAccess) !== JSON.stringify(desiredAccess)) {
            existing.access = desiredAccess;
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
            supervisor_key: supervisor.supervisor_key,
            role: supervisor.role || 'supervisor',
            access: Array.isArray(supervisor.access) ? supervisor.access : []
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

// Switch workshop tenant (for foreman/manager multi-access)
router.post('/switch-tenant', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        if (req.session.user.type !== 'supervisor') {
            return res.status(403).json({ error: 'Supervisor access required' });
        }

        const requested = String(req.body?.supervisor_key || '').trim();
        if (!requested) {
            return res.status(400).json({ error: 'supervisor_key is required' });
        }

        // Map requested tenant to access key
        const tenantToAccess = {
            component: 'components',
            pdis: 'pdi',
            rebuild: 'rebuild'
        };
        const needed = tenantToAccess[requested];
        if (!needed) {
            return res.status(400).json({ error: 'Invalid supervisor_key' });
        }

        const access = Array.isArray(req.session.user.access) ? req.session.user.access : [];
        const hasAccess = access.includes(needed) || access.includes('workshop_overview');
        if (!hasAccess) {
            return res.status(403).json({ error: 'Not allowed to access this workshop' });
        }

        req.session.user.supervisor_key = requested;
        res.json({ user: req.session.user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

module.exports = router;