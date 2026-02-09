// Authentication middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

const requireSupervisor = (req, res, next) => {
    if (!req.session.user || req.session.user.type !== 'supervisor') {
        return res.status(403).json({ error: 'Supervisor access required' });
    }
    next();
};

const requireTechnician = (req, res, next) => {
    if (!req.session.user || req.session.user.type !== 'technician') {
        return res.status(403).json({ error: 'Technician access required' });
    }
    next();
};

module.exports = {
    requireAuth,
    requireSupervisor,
    requireTechnician
};