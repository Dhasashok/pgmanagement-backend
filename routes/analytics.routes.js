const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getOccupancyAnalytics,
  getFinancialAnalytics
} = require('../controllers/analytics.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

router.get('/dashboard-summary', authRequired, getDashboardSummary);
router.get('/occupancy', authRequired, getOccupancyAnalytics);
router.get('/financial', ownerOnly, getFinancialAnalytics);

module.exports = router;
