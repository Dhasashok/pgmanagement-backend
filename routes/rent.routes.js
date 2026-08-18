const express = require('express');
const router = express.Router();
const {
  getRentRecords,
  getRentStats,
  generateMonthlyRent,
  recordOfflinePayment
} = require('../controllers/rent.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

router.get('/records', authRequired, getRentRecords);
router.get('/stats', authRequired, getRentStats);
router.post('/generate', ownerOnly, generateMonthlyRent);
router.post('/record-payment', ownerOnly, recordOfflinePayment);

module.exports = router;
