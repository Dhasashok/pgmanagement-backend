const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pg_secret_jwt_super_key_2026';

const authRequired = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }
};

const ownerOnly = (req, res, next) => {
  authRequired(req, res, () => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Access denied. Owner permissions required.' });
    }
    next();
  });
};

const tenantOnly = (req, res, next) => {
  authRequired(req, res, () => {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ success: false, message: 'Access denied. Tenant account required.' });
    }
    next();
  });
};

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

module.exports = {
  authRequired,
  ownerOnly,
  tenantOnly,
  generateToken,
  JWT_SECRET
};
