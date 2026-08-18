const http = require('http');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}/api`;

const request = (path, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
};

const runTests = async () => {
  console.log('🧪 Starting PG Management Backend API Test Suite...\n');
  let passed = 0;
  let failed = 0;

  const assert = (condition, testName) => {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  };

  try {
    // 1. Health Check
    const health = await request('/health');
    assert(health.status === 200 && health.data?.status === 'online', 'GET /api/health returns 200 OK');

    // 2. Owner Login
    const ownerLogin = await request('/auth/login', 'POST', {
      email: 'owner@pgmaster.com',
      password: 'admin123'
    });
    assert(ownerLogin.status === 200 && ownerLogin.data?.token, 'POST /api/auth/login (Owner) returns JWT token');
    const ownerToken = ownerLogin.data?.token;

    // 3. Tenant Login
    const tenantLogin = await request('/auth/login', 'POST', {
      email: 'rahul.patil@example.com',
      password: 'tenant123'
    });
    assert(tenantLogin.status === 200 && tenantLogin.data?.user?.role === 'tenant', 'POST /api/auth/login (Tenant) returns role tenant');
    const tenantToken = tenantLogin.data?.token;

    // 4. PG Hierarchy
    const hierarchy = await request('/pg/hierarchy');
    assert(hierarchy.status === 200 && hierarchy.data?.hierarchy?.length >= 5, 'GET /api/pg/hierarchy returns 5 floors');

    // 5. Emergency Search
    const searchRes = await request('/tenants/emergency-search?query=Rahul', 'GET', null, ownerToken);
    assert(searchRes.status === 200 && searchRes.data?.results?.length > 0, 'GET /api/tenants/emergency-search finds tenant Rahul');

    // 6. Rent Records
    const rentRes = await request('/rent/records', 'GET', null, ownerToken);
    assert(rentRes.status === 200 && Array.isArray(rentRes.data?.records), 'GET /api/rent/records returns billings list');

    // 7. Dashboard Summary
    const summaryRes = await request('/analytics/dashboard-summary', 'GET', null, ownerToken);
    assert(summaryRes.status === 200 && summaryRes.data?.data?.total_beds > 0, 'GET /api/analytics/dashboard-summary computes total beds');

    // 8. Occupancy Analytics
    const occRes = await request('/analytics/occupancy', 'GET', null, ownerToken);
    assert(occRes.status === 200 && occRes.data?.floorWise?.length > 0, 'GET /api/analytics/occupancy returns floor-wise breakdown');

    // 9. Financial Analytics
    const finRes = await request('/analytics/financial', 'GET', null, ownerToken);
    assert(finRes.status === 200 && Array.isArray(finRes.data?.revenueTrend), 'GET /api/analytics/financial returns revenue trend');

    // 10. Announcements
    const ancRes = await request('/announcements', 'GET', null, ownerToken);
    assert(ancRes.status === 200 && Array.isArray(ancRes.data?.announcements), 'GET /api/announcements returns active broadcasts');

    // 11. Razorpay Order Creation Security Test (Unauthorized access check)
    const unauthOrderRes = await request('/payments/create-order', 'POST', { rentId: 'rent-001' });
    assert(unauthOrderRes.status === 401, 'POST /api/payments/create-order rejects unauthenticated requests with 401');

    // 12. Razorpay Payment Verification Security Test (Invalid signature rejection)
    const invalidVerifyRes = await request('/payments/verify', 'POST', {
      razorpay_payment_id: 'pay_test_123',
      razorpay_order_id: 'order_test_123',
      razorpay_signature: 'invalid_sha256_sig'
    }, tenantToken);
    assert(invalidVerifyRes.status === 400 || invalidVerifyRes.status === 500, 'POST /api/payments/verify rejects invalid signature');

    // 13. Razorpay Webhook Security Test (Missing signature check)
    const unauthWebhookRes = await request('/payments/webhook', 'POST', { event: 'payment.captured' });
    assert(unauthWebhookRes.status === 400 || unauthWebhookRes.status === 500, 'POST /api/payments/webhook rejects unauthenticated webhook signatures');

    console.log(`\n================================`);
    console.log(`🏁 Test Results: ${passed} Passed, ${failed} Failed`);
    console.log(`================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Test execution error:', err.message);
    process.exit(1);
  }
};

runTests();
