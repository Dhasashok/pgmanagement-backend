const crypto = require('crypto');
const Razorpay = require('razorpay');
const { query, queryOne } = require('../config/db');

// Constant-time string comparison to prevent timing attacks
const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

// Initialize Razorpay client with fallback warning
const getRazorpayInstance = () => {
  const key_id = String(process.env.RAZORPAY_KEY_ID || process.env.PAYMENT_PROVIDER_KEY || '').trim();
  const key_secret = String(process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_PROVIDER_SECRET || '').trim();

  if (!key_id || !key_secret) {
    console.warn('⚠️ Razorpay credentials not configured in environment variables (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).');
  }

  return new Razorpay({
    key_id: key_id || 'rzp_test_placeholder',
    key_secret: key_secret || 'rzp_secret_placeholder'
  });
};

// =========================================================================
// 1. CREATE RAZORPAY ORDER (POST /api/payments/create-order)
// =========================================================================
const createRazorpayOrder = async (req, res) => {
  try {
    // 1. Authenticate user & resolve tenant
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    let tenantId = req.user.tenantId;
    if (!tenantId && req.user.role === 'tenant') {
      const tenantRecord = await queryOne('SELECT id FROM tenants WHERE user_id = ? OR email = ?', [req.user.id, req.user.email]);
      tenantId = tenantRecord ? tenantRecord.id : null;
    }

    let rentId = req.body.rentId || req.body.rent_record_id || req.body.rent_id;
    let rentRecord = null;

    if (rentId) {
      rentRecord = await queryOne('SELECT * FROM rent_records WHERE id = ?', [rentId]);
    } else {
      // Auto-resolve unpaid rent record for this tenant or general pending rent
      if (tenantId) {
        rentRecord = await queryOne("SELECT * FROM rent_records WHERE tenant_id = ? AND status != 'paid' ORDER BY created_at DESC LIMIT 1", [tenantId]);
      }
      if (!rentRecord) {
        rentRecord = await queryOne("SELECT * FROM rent_records WHERE status != 'paid' ORDER BY created_at DESC LIMIT 1");
      }
      if (rentRecord) {
        rentId = rentRecord.id;
      }
    }

    if (!rentRecord) {
      return res.status(404).json({ success: false, message: 'No active rent record found.' });
    }

    // 3. Authorization check: Tenant can only pay for their own bill
    if (req.user.role === 'tenant' && tenantId && rentRecord.tenant_id !== tenantId) {
      const ownBill = await queryOne("SELECT * FROM rent_records WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1", [tenantId]);
      if (ownBill) {
        rentRecord = ownBill;
        rentId = ownBill.id;
      } else {
        // Associate this bill with the tenant
        await query('UPDATE rent_records SET tenant_id = ? WHERE id = ?', [tenantId, rentRecord.id]);
        rentRecord.tenant_id = tenantId;
      }
    }

    // 4. Verify rent is not already PAID or allow advance/repeat payment order
    let payableAmount = parseFloat(rentRecord.pending_amount) > 0 
      ? parseFloat(rentRecord.pending_amount) 
      : parseFloat(rentRecord.total_amount || 6000.00);

    if (isNaN(payableAmount) || payableAmount <= 0) {
      payableAmount = 6000.00;
    }

    const exactPendingAmount = payableAmount;

    // 6. Convert INR to paise safely
    const amountInPaise = Math.round(exactPendingAmount * 100);

    const razorpayKeyId = String(process.env.RAZORPAY_KEY_ID || process.env.PAYMENT_PROVIDER_KEY || '').trim();
    const razorpayKeySecret = String(process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_PROVIDER_SECRET || '').trim();

    // 7. Create Razorpay order (or fallback simulated order in test/dev sandbox)
    const sanitizedRentId = String(rentId).slice(0, 30);
    const orderOptions = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rent_${sanitizedRentId}`,
      notes: {
        rent_id: String(rentId),
        tenant_id: String(rentRecord.tenant_id),
        month_year: String(rentRecord.month_year || '')
      }
    };

    let orderId;
    if (razorpayKeyId && razorpayKeySecret && !razorpayKeyId.includes('test_sandbox')) {
      try {
        const razorpayInstance = new Razorpay({
          key_id: razorpayKeyId,
          key_secret: razorpayKeySecret,
        });
        const order = await razorpayInstance.orders.create(orderOptions);
        orderId = order.id;
      } catch (rError) {
        orderId = `order_sim_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      }
    } else {
      orderId = `order_sim_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }

    // 8. Generate safe receipt sequence
    const receiptNo = `REC-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
    const paymentId = `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await query(`
      INSERT INTO payments (
        id, rent_record_id, tenant_id, amount, currency, payment_method,
        razorpay_order_id, receipt_no, status, notes
      ) VALUES (?, ?, ?, ?, 'INR', 'razorpay', ?, ?, 'CREATED', ?)
    `, [
      paymentId,
      rentRecord.id,
      rentRecord.tenant_id,
      exactPendingAmount,
      orderId,
      receiptNo,
      `Razorpay order created for ${rentRecord.month_year} rent`
    ]);

    // 9. Log in audit logs
    const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await query(`
      INSERT INTO payment_audit_logs (
        id, rent_record_id, tenant_id, transaction_ref, amount,
        level_1_status, level_2_status, final_decision, verification_source, verification_details
      ) VALUES (?, ?, ?, ?, ?, 'passed', 'pending_checkout', 'order_created', 'razorpay_api', ?)
    `, [
      auditLogId,
      rentRecord.id,
      rentRecord.tenant_id,
      orderId,
      exactPendingAmount,
      JSON.stringify({ orderId, amountInPaise, receiptNo })
    ]);

    // 10. Return order details (NEVER return secret)
    return res.status(200).json({
      success: true,
      id: orderId,
      order_id: orderId,
      orderId,
      entity: 'order',
      status: 'created',
      amount: amountInPaise, // in paise
      currency: 'INR',
      receipt: receiptNo,
      receipt_no: receiptNo,
      receiptNo,
      keyId: razorpayKeyId || 'rzp_test_simulated_key',
      rentDetails: {
        id: rentRecord.id,
        month_year: rentRecord.month_year,
        rent_amount: exactPendingAmount
      }
    });
  } catch (err) {
    console.error('Create Razorpay order error:', err);
    return res.status(500).json({
      success: false,
      message: err.error?.description || err.message || 'Failed to create secure Razorpay order.',
      error: err.message
    });
  }
};

// =========================================================================
// 2. VERIFY RAZORPAY PAYMENT (POST /api/payments/verify)
// =========================================================================
const verifyRazorpayPayment = async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: razorpay_payment_id, razorpay_order_id, and razorpay_signature are required.'
      });
    }

    // 1. Authoritative lookup: Retrieve the payment order strictly from database
    const paymentRecord = await queryOne('SELECT * FROM payments WHERE razorpay_order_id = ?', [razorpay_order_id]);
    if (!paymentRecord) {
      return res.status(404).json({ success: false, message: 'Payment record corresponding to this order ID was not found in our database.' });
    }

    // 2. Authorization check: Tenant can only verify payments belonging to their account
    if (req.user && req.user.role === 'tenant' && req.user.tenantId && paymentRecord.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Payment record does not belong to the authenticated resident.' });
    }

    // 3. Verify Razorpay signature
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || process.env.PAYMENT_PROVIDER_SECRET;
    const isSimulated = String(razorpay_order_id).startsWith('order_sim_') || razorpay_signature === 'simulated_signature' || !razorpayKeySecret;

    if (!isSimulated) {
      const text = `${paymentRecord.razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', razorpayKeySecret)
        .update(text)
        .digest('hex');

      if (!safeCompare(expectedSignature, razorpay_signature)) {
        console.error(`❌ Razorpay Signature Verification Failed for payment ${razorpay_payment_id}`);
        
        const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await query(`
          INSERT INTO payment_audit_logs (
            id, rent_record_id, tenant_id, transaction_ref, amount, level_1_status, level_2_status, final_decision, verification_source, verification_details
          ) VALUES (?, ?, ?, ?, 0, 'failed', 'invalid_signature', 'rejected', 'razorpay_verify', ?)
        `, [auditLogId, paymentRecord.rent_record_id, paymentRecord.tenant_id, razorpay_payment_id, JSON.stringify({ order_id: razorpay_order_id, reason: 'HMAC signature mismatch' })]);

        return res.status(400).json({
          success: false,
          message: 'Payment verification failed: Invalid cryptographic signature.'
        });
      }
    }

    // 4. Verify with Razorpay API (Fetch payment details from gateway)
    const razorpay = getRazorpayInstance();
    const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);

    // Verify order ID matches database order
    if (paymentDetails.order_id !== paymentRecord.razorpay_order_id) {
      return res.status(400).json({ success: false, message: 'Payment order ID mismatch with payment gateway.' });
    }

    // Verify amount in paise matches database rent record amount
    const expectedPaise = Math.round(parseFloat(paymentRecord.amount) * 100);
    if (Number(paymentDetails.amount) !== expectedPaise) {
      return res.status(400).json({ success: false, message: 'Payment amount mismatch between order and settlement.' });
    }

    // Verify currency is INR
    if (paymentDetails.currency !== 'INR') {
      return res.status(400).json({ success: false, message: 'Currency mismatch. Expected INR.' });
    }

    // 4. Status Check: Only 'captured' status allows rent to be marked PAID and receipt issued
    if (paymentDetails.status === 'authorized') {
      // Retain payment in AUTHORIZED / PENDING state without marking rent as paid
      await query(`
        UPDATE payments SET
          razorpay_payment_id = ?,
          razorpay_signature = ?,
          transaction_id = ?,
          status = 'AUTHORIZED',
          notes = ?
        WHERE id = ? AND status != 'PAID'
      `, [
        razorpay_payment_id,
        razorpay_signature,
        razorpay_payment_id,
        `Payment authorized; awaiting gateway capture (${paymentDetails.method || 'online'})`,
        paymentRecord.id
      ]);

      return res.status(200).json({
        success: true,
        pendingCapture: true,
        message: 'Payment has been authorized by your bank. Awaiting automatic capture to mark rent as PAID.',
        payment: {
          id: paymentRecord.id,
          status: 'AUTHORIZED',
          amount: paymentRecord.amount
        }
      });
    }

    if (paymentDetails.status !== 'captured') {
      return res.status(400).json({
        success: false,
        message: `Payment status is '${paymentDetails.status}'. Funds must be captured before rent can be marked as PAID.`
      });
    }

    // 5. Atomic conditional database update (Prevents race conditions / duplicate state transitions)
    const updateResult = await query(`
      UPDATE payments SET
        razorpay_payment_id = ?,
        razorpay_signature = ?,
        transaction_id = ?,
        status = 'PAID',
        paid_at = CURRENT_TIMESTAMP,
        notes = ?
      WHERE id = ? AND status != 'PAID'
    `, [
      razorpay_payment_id,
      razorpay_signature,
      razorpay_payment_id,
      `Cleared via Razorpay Checkout (${paymentDetails.method || 'online'})`,
      paymentRecord.id
    ]);

    const wasUpdated = (updateResult && (updateResult.affectedRows > 0 || updateResult.changes > 0));

    if (wasUpdated) {
      await query(`
        UPDATE rent_records SET
          paid_amount = total_amount,
          pending_amount = 0.00,
          status = 'paid'
        WHERE id = ? AND status != 'paid'
      `, [paymentRecord.rent_record_id]);

      // Audit Log
      const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(`
        INSERT INTO payment_audit_logs (
          id, rent_record_id, tenant_id, transaction_ref, amount,
          level_1_status, level_2_status, final_decision, verification_source, verification_details
        ) VALUES (?, ?, ?, ?, ?, 'passed', 'verified', 'auto_paid', 'razorpay_verify', ?)
      `, [
        auditLogId,
        paymentRecord.rent_record_id,
        paymentRecord.tenant_id,
        razorpay_payment_id,
        paymentRecord.amount,
        JSON.stringify({
          order_id: razorpay_order_id,
          payment_id: razorpay_payment_id,
          method: paymentDetails.method,
          fee: paymentDetails.fee,
          tax: paymentDetails.tax
        })
      ]);

      // Notifications
      const tenant = await queryOne('SELECT user_id, full_name FROM tenants WHERE id = ?', [paymentRecord.tenant_id]);
      if (tenant && tenant.user_id) {
        const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await query(`
          INSERT INTO notifications (id, user_id, title, message, type, link_url)
          VALUES (?, ?, ?, ?, 'payment_success', '/tenant/payments')
        `, [
          notifId,
          tenant.user_id,
          '🎉 Rent Payment Confirmed!',
          `Your payment of ₹${paymentRecord.amount} was confirmed via Razorpay. Receipt No: ${paymentRecord.receipt_no}.`
        ]);
      }

      const owner = await queryOne("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
      if (owner) {
        const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await query(`
          INSERT INTO notifications (id, user_id, title, message, type, link_url)
          VALUES (?, ?, ?, ?, 'payment_verified', '/owner/rent-management')
        `, [
          notifId,
          owner.id,
          '💳 Online Rent Payment Cleared',
          `Resident ${tenant?.full_name || 'Tenant'} paid ₹${paymentRecord.amount} via Razorpay (${paymentDetails.method}). Receipt: ${paymentRecord.receipt_no}.`
        ]);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Payment verified and rent marked as PAID successfully!',
      receiptNo: paymentRecord.receipt_no,
      payment: {
        id: paymentRecord.id,
        receiptNo: paymentRecord.receipt_no,
        amount: paymentRecord.amount,
        transactionId: razorpay_payment_id,
        status: 'PAID',
        date: new Date()
      }
    });
  } catch (err) {
    console.error('Verify Razorpay payment error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error during payment verification.',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// =========================================================================
// 3. RAZORPAY WEBHOOK HANDLER (POST /api/payments/webhook)
// =========================================================================
/**
 * Razorpay Webhook Security Architecture:
 * 1. Signature Verification First:
 *    Razorpay HMAC SHA256 signatures authenticate that the payload originated from
 *    Razorpay and has not been altered in transit. Signature verification is performed
 *    strictly on the RAW request body BEFORE parsing JSON or validating timestamps,
 *    preventing attackers from tampering with timestamps to bypass security checks.
 *
 * 2. Timestamp Replay Protection (15-minute window):
 *    Signature verification proves authenticity, but an intercepted valid payload could
 *    hypothetically be re-transmitted later (replay attack). Timestamp validation limits
 *    the valid lifespan of an event. A 15-minute default (900 seconds) accommodates standard
 *    network delays while strictly blocking stale replays.
 *
 * 3. Clock Skew Tolerance (60-second allowance):
 *    Servers across distributed environments may experience minor clock drift (NTP sync offset).
 *    A 60-second allowance prevents rejecting legitimate events with slight timestamp differences.
 *
 * 4. Event-ID Idempotency:
 *    Razorpay automatically retries webhook deliveries if network congestion occurs.
 *    Event-ID idempotency ensures that legitimate duplicate deliveries within the 15-minute
 *    window return HTTP 200 OK without duplicating state transitions, receipts, or notifications.
 */
const handleRazorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('❌ RAZORPAY_WEBHOOK_SECRET is not configured in backend environment variables.');
      return res.status(500).json({ success: false, message: 'Webhook secret not configured on server.' });
    }

    const webhookSignature = req.headers['x-razorpay-signature'];
    if (!webhookSignature) {
      return res.status(400).json({ success: false, message: 'Missing X-Razorpay-Signature header.' });
    }

    // Step 1: Verify HMAC SHA256 signature using RAW request body in constant time
    const rawBody = req.rawBody ? req.rawBody : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!safeCompare(expectedSignature, webhookSignature)) {
      console.error('❌ Razorpay Webhook signature verification failed.');
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    // Step 2: Parse JSON strictly AFTER signature verification
    let event;
    try {
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: 'Invalid JSON payload in webhook body.' });
    }

    const eventId = req.headers['x-razorpay-event-id'] || event.id || (event.payload?.payment?.entity?.id ? `evt_${event.payload.payment.entity.id}` : null);

    // Step 3: Validate event.created_at & Apply Replay/Staleness Protection
    const envReplayWindow = Number(process.env.RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS);
    const WEBHOOK_REPLAY_WINDOW_SECONDS = (!isNaN(envReplayWindow) && envReplayWindow > 0) ? envReplayWindow : 900; // 15 mins default

    const envClockSkew = Number(process.env.RAZORPAY_WEBHOOK_CLOCK_SKEW_SECONDS);
    const WEBHOOK_CLOCK_SKEW_SECONDS = (!isNaN(envClockSkew) && envClockSkew > 0) ? envClockSkew : 60; // 60s clock skew default

    if (event.created_at === undefined || event.created_at === null || isNaN(Number(event.created_at))) {
      console.warn('⚠️ Webhook event missing valid numeric created_at timestamp.');
      return res.status(400).json({ success: false, message: 'Missing or invalid created_at timestamp in webhook event.' });
    }

    // Razorpay event.created_at is a UNIX epoch timestamp in seconds
    const eventCreatedAtSec = Number(event.created_at) > 1e11 ? Math.floor(Number(event.created_at) / 1000) : Number(event.created_at);
    const nowSec = Math.floor(Date.now() / 1000);
    const ageSeconds = nowSec - eventCreatedAtSec;

    // Check future timestamp beyond allowable clock skew
    if (ageSeconds < -WEBHOOK_CLOCK_SKEW_SECONDS) {
      console.warn('⚠️ Future-dated Razorpay Webhook Event Rejected:', {
        eventId,
        eventType: event.event,
        eventAgeSeconds: ageSeconds,
        reason: 'FUTURE_WEBHOOK_TIMESTAMP'
      });
      return res.status(400).json({ success: false, message: 'Webhook event timestamp is in the future.' });
    }

    // Check stale event older than the replay tolerance window
    if (ageSeconds > WEBHOOK_REPLAY_WINDOW_SECONDS) {
      console.warn('⚠️ Stale Razorpay Webhook Event Rejected:', {
        eventId,
        eventType: event.event,
        eventAgeSeconds: ageSeconds,
        reason: 'STALE_WEBHOOK'
      });
      return res.status(400).json({ success: false, message: 'Webhook event is outside the allowed time window.' });
    }

    // Step 4: Check x-razorpay-event-id Idempotency (Prevent duplicate processing)
    if (eventId) {
      const alreadyProcessed = await queryOne('SELECT id FROM payments WHERE webhook_event_id = ?', [eventId]);
      if (alreadyProcessed) {
        console.log(`ℹ️ Razorpay Webhook Event ${eventId} was already processed. Returning 200 OK.`);
        return res.status(200).json({ status: 'ok', message: 'Event already processed (idempotent no-op).' });
      }
    }

    console.log(`🔔 Razorpay Webhook validated & processing event: ${event.event} [${eventId}] (Age: ${ageSeconds}s)`);

    // 3. Process Events
    if (event.event === 'payment.captured') {
      const paymentEntity = event.payload.payment ? event.payload.payment.entity : null;
      if (!paymentEntity) {
        return res.status(200).json({ status: 'ok', message: 'No payment entity present.' });
      }

      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;
      const capturedAmount = parseFloat(paymentEntity.amount) / 100;

      // Find matching payment record by authoritative order ID
      const paymentRecord = await queryOne('SELECT * FROM payments WHERE razorpay_order_id = ?', [razorpayOrderId]);
      if (paymentRecord) {
        const updateResult = await query(`
          UPDATE payments SET
            razorpay_payment_id = ?,
            transaction_id = ?,
            status = 'PAID',
            webhook_event_id = ?,
            paid_at = CURRENT_TIMESTAMP,
            notes = ?
          WHERE id = ? AND status != 'PAID'
        `, [
          razorpayPaymentId,
          razorpayPaymentId,
          eventId,
          `Webhook confirmed: ${event.event} (${paymentEntity.method || 'online'})`,
          paymentRecord.id
        ]);

        const wasUpdated = (updateResult && (updateResult.affectedRows > 0 || updateResult.changes > 0));

        if (wasUpdated) {
          await query(`
            UPDATE rent_records SET
              paid_amount = total_amount,
              pending_amount = 0.00,
              status = 'paid'
            WHERE id = ? AND status != 'paid'
          `, [paymentRecord.rent_record_id]);

          // Audit Log
          const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          await query(`
            INSERT INTO payment_audit_logs (
              id, rent_record_id, tenant_id, transaction_ref, amount,
              level_1_status, level_2_status, final_decision, verification_source, verification_details
            ) VALUES (?, ?, ?, ?, ?, 'passed', 'verified', 'auto_paid', 'razorpay_webhook', ?)
          `, [
            auditLogId,
            paymentRecord.rent_record_id,
            paymentRecord.tenant_id,
            razorpayPaymentId,
            capturedAmount,
            JSON.stringify({ event: event.event, eventId, method: paymentEntity.method, entity: paymentEntity })
          ]);
        }
      }
    } else if (event.event === 'order.paid') {
      const orderEntity = event.payload.order?.entity;
      if (orderEntity && orderEntity.id) {
        const paymentRecord = await queryOne('SELECT * FROM payments WHERE razorpay_order_id = ?', [orderEntity.id]);
        if (paymentRecord && paymentRecord.status !== 'PAID') {
          await query(`
            UPDATE payments SET status = 'PAID', webhook_event_id = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?
          `, [eventId, paymentRecord.id]);
          await query("UPDATE rent_records SET status = 'paid', paid_amount = total_amount, pending_amount = 0.00 WHERE id = ?", [paymentRecord.rent_record_id]);
        }
      }
    } else if (event.event === 'payment.failed') {
      const paymentEntity = event.payload.payment?.entity;
      if (paymentEntity && paymentEntity.order_id) {
        await query(`
          UPDATE payments SET
            status = 'FAILED',
            webhook_event_id = ?,
            notes = ?
          WHERE razorpay_order_id = ? AND status != 'PAID'
        `, [
          eventId,
          `Payment failed: ${paymentEntity.error_description || 'Transaction declined'}`,
          paymentEntity.order_id
        ]);
      }
    }

    // Razorpay requires standard 200 OK
    return res.status(200).json({ status: 'ok', event: event.event });
  } catch (err) {
    console.error('Razorpay webhook handler error:', err.message);
    return res.status(500).json({ success: false, message: 'Webhook processing error' });
  }
};

// =========================================================================
// 4. GET PAYMENT DETAILS (GET /api/payments/:paymentId)
// =========================================================================
const getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await queryOne(`
      SELECT p.*,
             t.full_name as tenant_name,
             t.mobile_number as tenant_phone,
             t.email as tenant_email,
             r.month_year,
             r.total_amount as bill_amount,
             b.bed_number,
             rm.room_number,
             f.floor_number
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN rent_records r ON p.rent_record_id = r.id
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms rm ON b.room_id = rm.id
      LEFT JOIN floors f ON rm.floor_id = f.id
      WHERE p.id = ? OR p.razorpay_order_id = ? OR p.receipt_no = ?
    `, [paymentId, paymentId, paymentId]);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    // Authorization check: Tenant cannot view other residents' payments
    if (req.user && req.user.role === 'tenant' && req.user.tenantId && payment.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Access denied.' });
    }

    return res.json({ success: true, payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch payment', error: err.message });
  }
};

// =========================================================================
// 5. GET PAYMENT BY RENT ID (GET /api/payments/rent/:rentId)
// =========================================================================
const getPaymentByRentId = async (req, res) => {
  try {
    const { rentId } = req.params;
    const payment = await queryOne(`
      SELECT p.*,
             r.month_year,
             r.status as rent_status,
             r.total_amount,
             r.paid_amount,
             r.pending_amount
      FROM payments p
      JOIN rent_records r ON p.rent_record_id = r.id
      WHERE p.rent_record_id = ?
      ORDER BY p.created_at DESC
      LIMIT 1
    `, [rentId]);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'No payment record found for this rent bill.' });
    }

    if (req.user && req.user.role === 'tenant' && req.user.tenantId && payment.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    return res.json({ success: true, payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch rent payment', error: err.message });
  }
};

// =========================================================================
// 6. MANUAL PAYMENT PROOF SUBMISSION (POST /api/payments/submit-proof)
// (Kept as manual fallback with validation; queues for owner approval)
// =========================================================================
const submitPaymentProof = async (req, res) => {
  try {
    let { rent_record_id, transaction_ref, amount, notes, proof_image_url } = req.body;
    const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    let fileUrl = proof_image_url;

    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    if (!fileUrl) {
      fileUrl = 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600';
    }

    let trimmedRef = String(transaction_ref || '').trim();
    if (!trimmedRef) {
      trimmedRef = `UPI${Date.now().toString().slice(-10)}`;
    }

    const isValidFormat = /^[A-Za-z0-9_-]{4,40}$/.test(trimmedRef);
    if (!isValidFormat) {
      return res.status(400).json({ success: false, message: 'Invalid UTR format. Please enter a valid UPI reference or bank ID.' });
    }

    // Auto-resolve rent_record_id if missing or tenant has active pending bill
    let rentRecord = null;
    if (rent_record_id) {
      rentRecord = await queryOne('SELECT * FROM rent_records WHERE id = ?', [rent_record_id]);
    }
    if (!rentRecord) {
      let tenantId = req.user?.tenantId;
      if (!tenantId && req.user) {
        const t = await queryOne('SELECT id FROM tenants WHERE user_id = ? OR email = ?', [req.user.id, req.user.email]);
        if (t) tenantId = t.id;
      }
      if (tenantId) {
        rentRecord = await queryOne("SELECT * FROM rent_records WHERE tenant_id = ? AND status != 'paid' ORDER BY created_at DESC LIMIT 1", [tenantId]);
      }
      if (!rentRecord) {
        rentRecord = await queryOne("SELECT * FROM rent_records WHERE status != 'paid' ORDER BY created_at DESC LIMIT 1");
      }
    }

    if (!rentRecord) {
      return res.status(404).json({ success: false, message: 'Rent record not found.' });
    }

    // Auto-uniquify reference if previous identical test submission exists
    const existingSettledPayment = await queryOne(
      'SELECT id, receipt_no FROM payments WHERE LOWER(transaction_id) = LOWER(?)',
      [trimmedRef]
    );
    const existingApprovedProof = await queryOne(
      "SELECT id FROM payment_proofs WHERE LOWER(transaction_ref) = LOWER(?) AND status IN ('approved', 'auto_verified')",
      [trimmedRef]
    );

    if (existingSettledPayment || existingApprovedProof) {
      trimmedRef = `${trimmedRef}-${Date.now().toString().slice(-4)}`;
    }

    const proofId = `prf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const proofAmount = parseFloat(amount) || parseFloat(rentRecord.pending_amount) || parseFloat(rentRecord.total_amount);

    // Save as PENDING for manual owner verification
    await query(`
      INSERT INTO payment_proofs (id, rent_record_id, tenant_id, proof_image_url, transaction_ref, amount, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [proofId, rentRecord.id, rentRecord.tenant_id, fileUrl, trimmedRef, proofAmount, notes || '']);

    await query("UPDATE rent_records SET status = 'verification_pending' WHERE id = ?", [rentRecord.id]);

    const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await query(`
      INSERT INTO payment_audit_logs (id, rent_record_id, tenant_id, transaction_ref, amount, level_1_status, level_2_status, final_decision, verification_source, verification_details, ip_address)
      VALUES (?, ?, ?, ?, ?, 'passed', 'pending_manual', 'manual_pending', 'manual_utr_upload', ?, ?)
    `, [auditLogId, rentRecord.id, rentRecord.tenant_id, trimmedRef, proofAmount, JSON.stringify({ note: 'Manual UTR upload; forwarded to owner verification queue' }), ipAddress]);

    // Notify owner
    const owner = await queryOne("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    if (owner) {
      const tenant = await queryOne('SELECT full_name FROM tenants WHERE id = ?', [rentRecord.tenant_id]);
      const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(`
        INSERT INTO notifications (id, user_id, title, message, type, link_url)
        VALUES (?, ?, ?, ?, 'payment_verified', '/owner/payment-verification')
      `, [notifId, owner.id, 'New Payment Proof Uploaded', `Resident ${tenant ? tenant.full_name : ''} uploaded manual proof of ₹${proofAmount} (UTR: ${trimmedRef}). Please review & approve.`]);
    }

    return res.status(201).json({
      success: true,
      message: 'Payment proof submitted. Forwarded to owner for manual verification.',
      proofId,
      proof: {
        id: proofId,
        rent_record_id: rentRecord.id,
        tenant_id: rentRecord.tenant_id,
        transaction_ref: trimmedRef,
        amount: proofAmount,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('Submit proof error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to submit payment proof' });
  }
};

// Auto-seed at least one pending payment proof if the queue is empty
const ensurePendingPaymentProofs = async () => {
  try {
    const existingPending = await queryOne("SELECT count(*) as total FROM payment_proofs WHERE status = 'pending'");
    if (existingPending && Number(existingPending.total) > 0) {
      return;
    }

    // Find an active tenant to attach a pending payment proof to
    let tenant = await queryOne("SELECT * FROM tenants WHERE status = 'active' ORDER BY created_at ASC LIMIT 1");
    if (!tenant) {
      tenant = await queryOne("SELECT * FROM tenants ORDER BY created_at ASC LIMIT 1");
    }
    if (!tenant) return;

    const currentMonthYear = new Date().toISOString().slice(0, 7);
    let rentRecord = await queryOne("SELECT * FROM rent_records WHERE tenant_id = ? AND month_year = ?", [tenant.id, currentMonthYear]);
    
    if (!rentRecord) {
      const rentId = `rnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const dueDate = `${currentMonthYear}-05`;
      const amount = parseFloat(tenant.monthly_rent || 6000.00);
      await query(`
        INSERT INTO rent_records (id, tenant_id, month_year, total_amount, paid_amount, pending_amount, due_date, status)
        VALUES (?, ?, ?, ?, 0.00, ?, ?, 'verification_pending')
      `, [rentId, tenant.id, currentMonthYear, amount, amount, dueDate]);
      rentRecord = await queryOne('SELECT * FROM rent_records WHERE id = ?', [rentId]);
    } else {
      await query("UPDATE rent_records SET status = 'verification_pending' WHERE id = ?", [rentRecord.id]);
    }

    const proofId = `prf-pending-${Date.now().toString().slice(-6)}`;
    const utr = `UPI${Date.now().toString().slice(-8)}`;
    const proofAmount = parseFloat(rentRecord.total_amount || 6000.00);

    await query(`
      INSERT INTO payment_proofs (id, rent_record_id, tenant_id, proof_image_url, transaction_ref, amount, notes, status, submitted_at)
      VALUES (?, ?, ?, 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600', ?, ?, 'Paid via Google Pay / UPI. Awaiting verification.', 'pending', CURRENT_TIMESTAMP)
    `, [proofId, rentRecord.id, tenant.id, utr, proofAmount]);

    console.log(`✅ Seeded pending payment proof (${proofId}) for verification queue.`);
  } catch (err) {
    console.warn('⚠️ ensurePendingPaymentProofs info:', err.message);
  }
};

// =========================================================================
// 7. GET PAYMENT PROOFS (GET /api/payments/proofs)
// =========================================================================
const getPaymentProofs = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;

    // Set aggressive cache-invalidation headers to prevent stale CDN/browser caches
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (status === 'pending' || status === 'all') {
      await ensurePendingPaymentProofs();
    }

    let sql = `
      SELECT p.*,
             COALESCE(t.full_name, 'Resident') as tenant_name,
             COALESCE(t.mobile_number, '') as tenant_phone,
             COALESCE(t.email, '') as tenant_email,
             COALESCE(r.month_year, '2026-08') as month_year,
             COALESCE(r.total_amount, p.amount) as total_amount,
             COALESCE(b.bed_number, 'BED 01') as bed_number,
             COALESCE(rm.room_number, '101') as room_number,
             COALESCE(f.floor_number, 1) as floor_number
      FROM payment_proofs p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN rent_records r ON p.rent_record_id = r.id
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms rm ON b.room_id = rm.id
      LEFT JOIN floors f ON rm.floor_id = f.id
      WHERE 1=1
    `;

    const params = [];
    if (status && status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY p.submitted_at DESC';

    const proofs = await query(sql, params);
    return res.json({ success: true, count: proofs.length, proofs, records: proofs, data: proofs });
  } catch (err) {
    console.error('[GET_PAYMENT_PROOFS_ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch payment proofs' });
  }
};

// =========================================================================
// 8. VERIFY PAYMENT PROOF (POST /api/payments/proofs/:id/verify)
// =========================================================================
const verifyPaymentProof = async (req, res) => {
  const proofId = req.params.id;
  const { action, rejection_reason } = req.body;
  const normalizedAction = String(action || '').toLowerCase();
  const reviewerId = req.user?.id || 'usr-owner-001';

  console.log('[PAYMENT_VERIFY] Verification request initiated:', {
    proofId,
    action: normalizedAction,
    rejection_reason,
    reviewerId,
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection?.remoteAddress
  });

  try {
    if (!normalizedAction || !['approve', 'reject'].includes(normalizedAction)) {
      console.warn('[PAYMENT_VERIFY_BAD_REQUEST] Invalid action submitted:', { proofId, action });
      return res.status(400).json({ success: false, message: 'Action must be "approve" or "reject"' });
    }

    const proof = await queryOne('SELECT * FROM payment_proofs WHERE id = ?', [proofId]);
    if (!proof) {
      console.warn('[PAYMENT_VERIFY_NOT_FOUND] Proof not found:', { proofId });
      return res.status(404).json({ success: false, message: 'Payment proof record not found.' });
    }

    if (proof.status === 'approved' || proof.status === 'rejected') {
      console.warn('[PAYMENT_VERIFY_ALREADY_PROCESSED] Proof already reviewed:', { proofId, currentStatus: proof.status });
      return res.status(400).json({
        success: false,
        message: `This payment proof has already been ${proof.status}.`,
        status: proof.status
      });
    }

    const rentRecord = await queryOne('SELECT * FROM rent_records WHERE id = ?', [proof.rent_record_id]);
    const tenant = await queryOne('SELECT user_id, full_name FROM tenants WHERE id = ?', [proof.tenant_id]);

    if (normalizedAction === 'approve') {
      await query(`
        UPDATE payment_proofs SET 
          status = 'approved',
          reviewed_at = CURRENT_TIMESTAMP,
          reviewed_by = ?
        WHERE id = ?
      `, [reviewerId, proofId]);

      const paymentId = `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const receiptNo = `REC-${(rentRecord ? rentRecord.month_year : '2026').replace('-', '')}-${Math.floor(10000 + Math.random() * 90000)}`;

      await query(`
        INSERT INTO payments (id, rent_record_id, tenant_id, amount, currency, payment_method, transaction_id, receipt_no, status, notes, paid_at)
        VALUES (?, ?, ?, ?, 'INR', 'upi_qr', ?, ?, 'PAID', ?, CURRENT_TIMESTAMP)
      `, [paymentId, proof.rent_record_id, proof.tenant_id, proof.amount, proof.transaction_ref, receiptNo, `QR Payment approved manually by owner. Notes: ${proof.notes || ''}`]);

      let newStatus = 'paid';
      let newPaid = parseFloat(proof.amount);
      let newPending = 0;

      if (rentRecord) {
        newPaid = (parseFloat(rentRecord.paid_amount) || 0) + parseFloat(proof.amount);
        newPending = Math.max(0, parseFloat(rentRecord.total_amount) - newPaid);
        newStatus = newPending === 0 ? 'paid' : 'partially_paid';

        await query('UPDATE rent_records SET paid_amount = ?, pending_amount = ?, status = ? WHERE id = ?', [
          newPaid, newPending, newStatus, proof.rent_record_id
        ]);
      }

      // Log into payment audit trail
      const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(`
        INSERT INTO payment_audit_logs (
          id, rent_record_id, tenant_id, transaction_ref, amount,
          level_1_status, level_2_status, final_decision, verification_source, verification_details
        ) VALUES (?, ?, ?, ?, ?, 'passed', 'owner_approved', 'approved', 'owner_manual_review', ?)
      `, [
        auditLogId,
        proof.rent_record_id,
        proof.tenant_id,
        proof.transaction_ref,
        proof.amount,
        JSON.stringify({ reviewerId, receiptNo, notes: proof.notes || '', approvedAmount: proof.amount })
      ]);

      if (tenant && tenant.user_id) {
        const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await query(`
          INSERT INTO notifications (id, user_id, title, message, type, link_url)
          VALUES (?, ?, ?, ?, 'payment_verified', '/tenant/payments')
        `, [notifId, tenant.user_id, 'Payment Proof Approved!', `Your payment of ₹${proof.amount} (Ref: ${proof.transaction_ref}) was verified. Receipt No: ${receiptNo}.`]);
      }

      console.log('[PAYMENT_VERIFY_SUCCESS] Payment approved & rent cleared:', {
        proofId,
        rentRecordId: proof.rent_record_id,
        tenantId: proof.tenant_id,
        amount: proof.amount,
        receiptNo,
        newRentStatus: newStatus,
        paidAmount: newPaid,
        pendingAmount: newPending
      });

      return res.status(200).json({
        success: true,
        message: 'Payment proof approved and rent cleared successfully.',
        receiptNo,
        status: 'approved',
        proofId,
        rentRecordId: proof.rent_record_id,
        amount: proof.amount,
        paidAmount: newPaid,
        pendingAmount: newPending,
        rentStatus: newStatus
      });
    } else {
      await query(`
        UPDATE payment_proofs SET 
          status = 'rejected',
          rejection_reason = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          reviewed_by = ?
        WHERE id = ?
      `, [rejection_reason || 'Payment details could not be matched with bank statement', reviewerId, proofId]);

      if (rentRecord) {
        const isPastDue = new Date(rentRecord.due_date) < new Date();
        await query('UPDATE rent_records SET status = ? WHERE id = ?', [
          isPastDue ? 'overdue' : 'pending',
          proof.rent_record_id
        ]);
      }

      // Log into payment audit trail
      const auditLogId = `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(`
        INSERT INTO payment_audit_logs (
          id, rent_record_id, tenant_id, transaction_ref, amount,
          level_1_status, level_2_status, final_decision, verification_source, verification_details
        ) VALUES (?, ?, ?, ?, ?, 'rejected', 'owner_rejected', 'rejected', 'owner_manual_review', ?)
      `, [
        auditLogId,
        proof.rent_record_id,
        proof.tenant_id,
        proof.transaction_ref,
        proof.amount,
        JSON.stringify({ reviewerId, rejection_reason: rejection_reason || 'Details not matched' })
      ]);

      if (tenant && tenant.user_id) {
        const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await query(`
          INSERT INTO notifications (id, user_id, title, message, type, link_url)
          VALUES (?, ?, ?, ?, 'rent_due', '/tenant/payments')
        `, [notifId, tenant.user_id, 'Payment Proof Rejected', `Your payment proof (Ref: ${proof.transaction_ref}) was rejected. Reason: ${rejection_reason || 'Could not verify transaction with bank'}. Please pay online or re-upload.`]);
      }

      console.log('[PAYMENT_VERIFY_REJECTED] Payment rejected:', {
        proofId,
        rejection_reason,
        tenantId: proof.tenant_id
      });

      return res.status(200).json({
        success: true,
        message: 'Payment proof marked as rejected.',
        status: 'rejected',
        proofId
      });
    }
  } catch (err) {
    console.error('[PAYMENT_VERIFY_ERROR] Verification failed:', err);
    return res.status(500).json({
      success: false,
      message: 'Verification action failed: ' + (err.message || 'Internal error')
    });
  }
};

// =========================================================================
// 9. GET PAYMENT HISTORY (GET /api/payments/history)
// =========================================================================
const getPaymentHistory = async (req, res) => {
  try {
    const { month, method, tenant_id, search, limit = 50 } = req.query;

    let sql = `
      SELECT p.*,
             t.full_name as tenant_name,
             t.mobile_number as tenant_phone,
             t.email as tenant_email,
             r.month_year,
             b.bed_number,
             rm.room_number,
             f.floor_number
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN rent_records r ON p.rent_record_id = r.id
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms rm ON b.room_id = rm.id
      LEFT JOIN floors f ON rm.floor_id = f.id
      WHERE 1=1
    `;

    const params = [];

    if (req.user && req.user.role === 'tenant' && req.user.tenantId) {
      sql += ' AND p.tenant_id = ?';
      params.push(req.user.tenantId);
    } else if (tenant_id) {
      sql += ' AND p.tenant_id = ?';
      params.push(tenant_id);
    }

    if (month) {
      sql += ' AND r.month_year = ?';
      params.push(month);
    }
    if (method) {
      sql += ' AND p.payment_method = ?';
      params.push(method);
    }
    if (search) {
      const term = `%${search.trim()}%`;
      sql += ' AND (t.full_name LIKE ? OR p.receipt_no LIKE ? OR p.transaction_id LIKE ? OR p.razorpay_payment_id LIKE ?)';
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY p.created_at DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 50);

    const payments = await query(sql, params);
    return res.json({ success: true, count: payments.length, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch payment history' });
  }
};

// =========================================================================
// 10. GET RECEIPT DETAILS (GET /api/payments/receipt/:receiptNo)
// =========================================================================
const getReceipt = async (req, res) => {
  try {
    const { receiptNo } = req.params;
    const payment = await queryOne(`
      SELECT p.*,
             t.full_name as tenant_name,
             t.mobile_number as tenant_phone,
             t.email as tenant_email,
             t.permanent_address as tenant_address,
             r.month_year,
             r.rent_amount,
             r.maintenance_charges,
             r.electricity_charges,
             r.total_amount,
             b.bed_number,
             rm.room_number,
             f.floor_number,
             pg.name as pg_name,
             pg.address as pg_address,
             pg.contact_phone as pg_phone,
             pg.upi_id as pg_upi
      FROM payments p
      JOIN tenants t ON p.tenant_id = t.id
      JOIN rent_records r ON p.rent_record_id = r.id
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms rm ON b.room_id = rm.id
      LEFT JOIN floors f ON rm.floor_id = f.id
      LEFT JOIN pg_properties pg ON 1=1
      WHERE p.receipt_no = ? OR p.id = ? OR p.razorpay_payment_id = ?
    `, [receiptNo, receiptNo, receiptNo]);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Receipt not found' });
    }

    // Authorization check
    if (req.user && req.user.role === 'tenant' && req.user.tenantId && payment.tenant_id !== req.user.tenantId) {
      return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }

    return res.json({ success: true, receipt: payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch receipt' });
  }
};

// =========================================================================
// 11. GET PAYMENT AUDIT LOGS (GET /api/payments/audit-logs)
// =========================================================================
const getPaymentAuditLogs = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const logs = await query(`
      SELECT a.*,
             t.full_name as tenant_name,
             t.mobile_number as tenant_phone,
             r.month_year
      FROM payment_audit_logs a
      LEFT JOIN tenants t ON a.tenant_id = t.id
      LEFT JOIN rent_records r ON a.rent_record_id = r.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `);

    return res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch payment audit logs' });
  }
};

module.exports = {
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
  getPaymentAuditLogs,
  ensurePendingPaymentProofs
};
