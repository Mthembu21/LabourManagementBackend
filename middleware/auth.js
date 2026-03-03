// Authentication middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.tenant = {
        supervisor_key: req.session.user.supervisor_key || 'component',
        user_type: req.session.user.type
    };
    next();
};

const requireSupervisor = (req, res, next) => {
    if (!req.session.user || req.session.user.type !== 'supervisor') {
        return res.status(403).json({ error: 'Supervisor access required' });
    }
    if (!req.session.user.supervisor_key) {
        return res.status(403).json({ error: 'Supervisor tenant is missing' });
    }
    req.tenant = {
        supervisor_key: req.session.user.supervisor_key,
        user_type: req.session.user.type
    };
    next();
};

const requireTechnician = (req, res, next) => {
    if (!req.session.user || req.session.user.type !== 'technician') {
        return res.status(403).json({ error: 'Technician access required' });
    }
    req.tenant = {
        supervisor_key: req.session.user.supervisor_key || 'component',
        user_type: req.session.user.type
    };
    next();
};

const tenantQuery = (supervisorKey) => {
    if (supervisorKey === 'component') {
        return { $or: [{ supervisor_key: supervisorKey }, { supervisor_key: { $exists: false } }] };
    }
    return { supervisor_key: supervisorKey };
};

module.exports = {
    requireAuth,
    requireSupervisor,
    requireTechnician,
    tenantQuery
};