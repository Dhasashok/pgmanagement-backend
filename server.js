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

// CORS setup
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps, curl, postman)
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(null, true); // Permissive for preview/test environments
  },
  credentials: true
}));

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

// Health check endpoint
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
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'An internal server error occurred',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 404 Route handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found on this server.` });
});

// Start Server
const start = async () => {
  try {
    await initializeDatabase();
    await activateDuePrebookings();
    await ensurePendingPaymentProofs();
    // Keep future reservations in sync even when no owner is viewing the tenant list.
    setInterval(() => {
      activateDuePrebookings().catch((error) => console.error('Pre-booking activation failed:', error));
    }, 60 * 60 * 1000);
    app.listen(PORT, () => {
      console.log(`🚀 PG Management Server running on port ${PORT}`);
      console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start backend server:', error);
    process.exit(1);
  }
};

start();
