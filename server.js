const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { initializeDatabase } = require('./config/db');
const { activateDuePrebookings } = require('./controllers/tenants.controller');
const { ensurePendingPaymentProofs } = require('./controllers/payment.controller');

// Route imports
const authRoutes = require('./routes/auth.routes');
const pgRoutes = require('./routes/pg.routes');
const tenantsRoutes = require('./routes/tenants.routes');
const rentRoutes = require('./routes/rent.routes');
const paymentRoutes = require('./routes/payment.routes');
const complaintsRoutes = require('./routes/complaints.routes');
const announcementsRoutes = require('./routes/announcements.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const analyticsRoutes = require('./routes/analytics.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Bulletproof CORS & Preflight middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Razorpay-Signature, Cache-Control, Pragma, Expires');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Content-Range, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle browser preflight OPTIONS immediately
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

const corsOptions = {
  origin: (origin, callback) => callback(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Razorpay-Signature', 'Cache-Control', 'Pragma', 'Expires']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Static files for uploaded images & receipts
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

// API Routes (supports both /api/* and root /*)
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);

app.use('/api/pg', pgRoutes);
app.use('/pg', pgRoutes);

app.use('/api/tenants', tenantsRoutes);
app.use('/tenants', tenantsRoutes);

app.use('/api/rent', rentRoutes);
app.use('/rent', rentRoutes);
app.use('/api/rents', rentRoutes);
app.use('/rents', rentRoutes);

app.use('/api/payment', paymentRoutes);
app.use('/payment', paymentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/payments', paymentRoutes);

app.use('/api/complaints', complaintsRoutes);
app.use('/complaints', complaintsRoutes);

app.use('/api/announcements', announcementsRoutes);
app.use('/announcements', announcementsRoutes);

app.use('/api/notifications', notificationsRoutes);
app.use('/notifications', notificationsRoutes);

app.use('/api/analytics', analyticsRoutes);
app.use('/analytics', analyticsRoutes);

// Root & Health check endpoints
const welcomeHandler = (req, res) => {
  res.json({
    status: 'online',
    message: '🚀 PG Management Backend API is running successfully.',
    service: 'PG Management Backend API',
    version: '1.0.0',
    frontend: 'https://pgmanagement-frontend.vercel.app',
    health: '/api/health'
  });
};
app.get('/', welcomeHandler);

const healthHandler = (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'PG Management Backend API',
    version: '1.0.0'
  });
};
app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled API Error:', err);
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'An internal server error occurred',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 Route handler
app.use('*', (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found on this server.` });
});

// Start Server immediately so Render health checks pass without 502
const start = async () => {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PG Management Server running on port ${PORT} (0.0.0.0)`);
    console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  });

  try {
    await initializeDatabase();
    await activateDuePrebookings().catch((err) => console.warn('Pre-booking sync notice:', err.message));
    await ensurePendingPaymentProofs().catch((err) => console.warn('Ensure proofs notice:', err.message));

    // Keep future reservations in sync even when no owner is viewing the tenant list.
    setInterval(() => {
      activateDuePrebookings().catch((error) => console.error('Pre-booking activation failed:', error));
    }, 60 * 60 * 1000);
  } catch (error) {
    console.error('⚠️ Database initialization notice (server continuing):', error.message);
  }
};

start();
