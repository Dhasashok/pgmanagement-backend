const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
  getPaymentById,
  getPaymentByRentId,
  submitPaymentProof,
  getPaymentProofs,
  verifyPaymentProof,
  getPaymentHistory,
  getReceipt,
  getPaymentAuditLogs
} = require('../controllers/payment.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

// ==========================================
// RAZORPAY PAYMENT GATEWAY ROUTES
// ==========================================

// 1. Create Razorpay order (Authenticated tenant/user)
router.post('/create-order', authRequired, createRazorpayOrder);

// 2. Client verification endpoint (HMAC SHA256 verification)
router.post('/verify', authRequired, verifyRazorpayPayment);

// 3. Razorpay Webhook listener (Public, verified via X-Razorpay-Signature)
router.post('/webhook', handleRazorpayWebhook);

// 4. Payment lookup by Rent ID (Authenticated)
router.get('/rent/:rentId', authRequired, getPaymentByRentId);

// 5. Payment lookup by Payment ID (Authenticated)
router.get('/details/:paymentId', authRequired, getPaymentById);

// ==========================================
// MANUAL PAYMENT PROOFS & RECEIPT ROUTES
// ==========================================

// Upload manual payment screenshot (Fallback)
router.post('/submit-proof', authRequired, upload.single('proof_file'), submitPaymentProof);

// Owner review queue for manual proofs
router.get('/proofs', ownerOnly, getPaymentProofs);
router.post('/proofs/:id/verify', ownerOnly, verifyPaymentProof);

// Payment audit logs for owner
router.get('/audit-logs', ownerOnly, getPaymentAuditLogs);

// Payment history & Receipt
router.get('/history', authRequired, getPaymentHistory);
router.get('/receipt/:receiptNo', authRequired, getReceipt);

module.exports = router;
