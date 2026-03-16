// Authentication middleware
const tenantToAccessKey = (supervisorKey) => {
    if (supervisorKey === 'component') return 'components';
    if (supervisorKey === 'pdis') return 'pdi';
    if (supervisorKey === 'rebuild') return 'rebuild';
    return null;
};

const hasWorkshopAccess = (user, supervisorKey) => {
    if (!user || user.type !== 'supervisor') return false;
    const needed = tenantToAccessKey(supervisorKey);
    if (!needed) return false;
    const access = Array.isArray(user.access) ? user.access : [];
    // Managers may carry workshop_overview; allow it as global access.
    return access.includes(needed) || access.includes('workshop_overview');
};

const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    // If this is a supervisor/foreman/manager session, ensure they can access the current tenant
    if (req.session.user.type === 'supervisor') {
        const key = req.session.user.supervisor_key || 'component';
        if (!hasWorkshopAccess(req.session.user, key)) {
            return res.status(403).json({ error: 'Not allowed to access this workshop' });
        }
    }

    req.tenant = {
        supervisor_key: req.session.user.supervisor_key || 'component',
        user_type: req.session.user.type,
        role: req.session.user.role || null,
        access: Array.isArray(req.session.user.access) ? req.session.user.access : []
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

     if (!hasWorkshopAccess(req.session.user, req.session.user.supervisor_key)) {
        return res.status(403).json({ error: 'Not allowed to access this workshop' });
     }

    req.tenant = {
        supervisor_key: req.session.user.supervisor_key,
        user_type: req.session.user.type,
        role: req.session.user.role || null,
        access: Array.isArray(req.session.user.access) ? req.session.user.access : []
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