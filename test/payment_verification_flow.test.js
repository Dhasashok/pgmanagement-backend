const { initializeDatabase, query, queryOne } = require('../config/db');
const { generateToken } = require('../middleware/auth');
const http = require('http');
const express = require('express');
const paymentRoutes = require('../routes/payment.routes');
const rentRoutes = require('../routes/rent.routes');
const authRoutes = require('../routes/auth.routes');

const setupTestApp = async () => {
  await initializeDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentRoutes);
  app.use('/api/payment', paymentRoutes);
  app.use('/api/rent', rentRoutes);
  app.use('/api/auth', authRoutes);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
};

const makeRequest = (port, path, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const runSuite = async () => {
  console.log('🧪 Starting Approve & Clear Rent Action Path Integration Tests...\n');
  const { server, port } = await setupTestApp();

  let passed = 0;
  let failed = 0;

  const assert = (condition, msg) => {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  try {
    const timestamp = Date.now();
    const testTenantId = `tnt-test-${timestamp}`;
    const testUserId = `usr-test-${timestamp}`;

    // Create test user and tenant
    await query(`
      INSERT INTO users (id, name, email, phone, password_hash, role)
      VALUES (?, 'Test Resident', ?, '9988776655', 'hashed_pw', 'tenant')
    `, [testUserId, `resident_${timestamp}@test.com`]);

    await query(`
      INSERT INTO tenants (
        id, user_id, full_name, email, mobile_number,
        emergency_contact_name, emergency_contact_number, relationship_with_emergency_contact,
        id_proof_number, joining_date, monthly_rent, security_deposit, rent_due_day, status
      )
      VALUES (?, ?, 'Test Resident', ?, '9988776655', 'Parent Name', '9988776650', 'Parent', '123456789012', '2026-01-01', 6500.00, 10000.00, 5, 'active')
    `, [testTenantId, testUserId, `resident_${timestamp}@test.com`]);

    // 1. Generate Owner & Tenant Tokens
    const ownerToken = generateToken({ id: 'usr-owner-001', role: 'owner', email: 'owner@pgmaster.com' });
    const tenantToken = generateToken({ id: testUserId, role: 'tenant', email: `resident_${timestamp}@test.com`, tenantId: testTenantId });

    // Create test rent record
    const testRentId = `rnt-test-${timestamp}`;
    const testProofId = `prf-test-${timestamp}`;
    const testMonth = '2026-08';

    await query(`
      INSERT INTO rent_records (id, tenant_id, month_year, rent_amount, total_amount, paid_amount, pending_amount, due_date, status)
      VALUES (?, ?, ?, 6500.00, 6500.00, 0.00, 6500.00, '2026-08-05', 'verification_pending')
    `, [testRentId, testTenantId, testMonth]);

    // Insert test payment proof
    await query(`
      INSERT INTO payment_proofs (id, rent_record_id, tenant_id, proof_image_url, transaction_ref, amount, notes, status, submitted_at)
      VALUES (?, ?, ?, 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600', 'UTR99887766', 6500.00, 'Paid via GPay', 'pending', CURRENT_TIMESTAMP)
    `, [testProofId, testRentId, testTenantId]);

    // 2. Fetch pending payment proofs as Owner
    const listRes = await makeRequest(port, '/payments/proofs?status=pending', 'GET', null, ownerToken);
    assert(listRes.status === 200 && Array.isArray(listRes.data?.proofs), 'GET /api/payments/proofs?status=pending returns 200 and proofs array');
    const targetProof = listRes.data?.proofs?.find(p => p.id === testProofId);
    assert(!!targetProof, `Found newly created test proof in pending queue (${testProofId})`);

    // 3. Test Security: Reject unauthenticated or tenant attempts to approve
    const unauthRes = await makeRequest(port, `/payments/proofs/${testProofId}/verify`, 'POST', { action: 'approve' });
    assert(unauthRes.status === 401, 'Unauthenticated approval attempt returns 401 Unauthorized');

    const tenantRes = await makeRequest(port, `/payments/proofs/${testProofId}/verify`, 'POST', { action: 'approve' }, tenantToken);
    assert(tenantRes.status === 403, 'Tenant approval attempt returns 403 Forbidden (Owner required)');

    // 4. Approve Payment Proof as Owner
    const approveRes = await makeRequest(port, `/payments/proofs/${testProofId}/verify`, 'POST', { action: 'approve' }, ownerToken);
    assert(approveRes.status === 200 && approveRes.data?.success === true, 'Owner POST /api/payments/proofs/:id/verify with action=approve returns 200 OK');
    assert(approveRes.data?.status === 'approved', 'Response indicates status: approved');
    assert(!!approveRes.data?.receiptNo, `Response includes receipt number: ${approveRes.data?.receiptNo}`);
    assert(approveRes.data?.paidAmount === 6500 && approveRes.data?.pendingAmount === 0, 'Response calculates paidAmount=6500 and pendingAmount=0');
    assert(approveRes.data?.rentStatus === 'paid', 'Response confirms rentStatus: paid');

    // 5. Verify Database Writes
    const dbProof = await queryOne('SELECT * FROM payment_proofs WHERE id = ?', [testProofId]);
    assert(dbProof && dbProof.status === 'approved', 'Database payment_proofs status updated to approved');

    const dbRent = await queryOne('SELECT * FROM rent_records WHERE id = ?', [testRentId]);
    assert(dbRent && dbRent.status === 'paid' && parseFloat(dbRent.pending_amount) === 0, 'Database rent_records updated: status=paid, pending_amount=0');

    const dbPayment = await queryOne('SELECT * FROM payments WHERE rent_record_id = ? AND transaction_id = ?', [testRentId, 'UTR99887766']);
    assert(dbPayment && dbPayment.status === 'PAID', 'Database payments record inserted with status PAID');

    const dbAudit = await queryOne('SELECT * FROM payment_audit_logs WHERE rent_record_id = ? ORDER BY created_at DESC LIMIT 1', [testRentId]);
    assert(dbAudit && dbAudit.final_decision === 'approved', 'Database payment_audit_logs contains approval audit trail record');

    // 6. Verify Duplicate Attempt Rejection
    const dupRes = await makeRequest(port, `/payments/proofs/${testProofId}/verify`, 'POST', { action: 'approve' }, ownerToken);
    assert(dupRes.status === 400 && dupRes.data?.success === false, 'Re-approving an already approved proof returns 400 Bad Request');

    // 7. Verify Rejection Flow with Reason
    const rejectTenantId = `tnt-rej-${timestamp}`;
    const rejectUserId = `usr-rej-${timestamp}`;

    await query(`
      INSERT INTO users (id, name, email, phone, password_hash, role)
      VALUES (?, 'Reject Test Resident', ?, '9988771122', 'hashed_pw', 'tenant')
    `, [rejectUserId, `reject_${timestamp}@test.com`]);

    await query(`
      INSERT INTO tenants (
        id, user_id, full_name, email, mobile_number,
        emergency_contact_name, emergency_contact_number, relationship_with_emergency_contact,
        id_proof_number, joining_date, monthly_rent, security_deposit, rent_due_day, status
      )
      VALUES (?, ?, 'Reject Test Resident', ?, '9988771122', 'Parent 2', '9988771120', 'Parent', '987654321098', '2026-01-01', 5000.00, 10000.00, 5, 'active')
    `, [rejectTenantId, rejectUserId, `reject_${timestamp}@test.com`]);

    const rejectProofId = `prf-rej-${timestamp}`;
    const rejectRentId = `rnt-rej-${timestamp}`;

    await query(`
      INSERT INTO rent_records (id, tenant_id, month_year, rent_amount, total_amount, paid_amount, pending_amount, due_date, status)
      VALUES (?, ?, '2026-08', 5000.00, 5000.00, 0.00, 5000.00, '2026-08-05', 'verification_pending')
    `, [rejectRentId, rejectTenantId]);

    await query(`
      INSERT INTO payment_proofs (id, rent_record_id, tenant_id, proof_image_url, transaction_ref, amount, notes, status, submitted_at)
      VALUES (?, ?, ?, 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600', 'UTR-REJECT-01', 5000.00, 'Test reject', 'pending', CURRENT_TIMESTAMP)
    `, [rejectProofId, rejectRentId, rejectTenantId]);

    const rejectRes = await makeRequest(port, `/payments/proofs/${rejectProofId}/verify`, 'POST', {
      action: 'reject',
      rejection_reason: 'Invalid UTR reference not matching bank statement'
    }, ownerToken);

    assert(rejectRes.status === 200 && rejectRes.data?.status === 'rejected', 'Owner rejection returns 200 with status: rejected');

    const dbRejProof = await queryOne('SELECT * FROM payment_proofs WHERE id = ?', [rejectProofId]);
    assert(dbRejProof && dbRejProof.status === 'rejected' && dbRejProof.rejection_reason.includes('Invalid UTR'), 'Database payment_proofs updated with rejected status and reason');

    const dbRejAudit = await queryOne('SELECT * FROM payment_audit_logs WHERE rent_record_id = ? ORDER BY created_at DESC LIMIT 1', [rejectRentId]);
    assert(dbRejAudit && dbRejAudit.final_decision === 'rejected', 'Database payment_audit_logs contains rejection audit trail record');

    // 8. Clean up test records
    await query('DELETE FROM payment_audit_logs WHERE rent_record_id IN (?, ?)', [testRentId, rejectRentId]);
    await query('DELETE FROM payments WHERE rent_record_id IN (?, ?)', [testRentId, rejectRentId]);
    await query('DELETE FROM payment_proofs WHERE id IN (?, ?)', [testProofId, rejectProofId]);
    await query('DELETE FROM rent_records WHERE id IN (?, ?)', [testRentId, rejectRentId]);
    await query('DELETE FROM tenants WHERE id IN (?, ?)', [testTenantId, rejectTenantId]);
    await query('DELETE FROM users WHERE id IN (?, ?)', [testUserId, rejectUserId]);

    console.log(`\n================================`);
    console.log(`🏁 All Action Path Tests: ${passed} Passed, ${failed} Failed`);
    console.log(`================================\n`);

    server.close();
    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error('Test failed with exception:', err);
    server.close();
    process.exit(1);
  }
};

runSuite();
