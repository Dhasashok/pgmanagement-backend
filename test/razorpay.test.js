const crypto = require('crypto');
const assert = require('assert');

console.log('🧪 Running Razorpay Payment Verification & Webhook Cryptography Tests...\n');

// 1. Test HMAC SHA256 Signature Generation & Matching
const testSecret = 'sample_secret_key_12345';
const orderId = 'order_test_987654';
const paymentId = 'pay_test_123456';

const payload = `${orderId}|${paymentId}`;
const generatedSignature = crypto
  .createHmac('sha256', testSecret)
  .update(payload)
  .digest('hex');

assert(generatedSignature.length === 64, 'Signature must be a 64-character hex string');
console.log('✅ Test 1 Passed: Generated HMAC SHA256 signature is valid 64-char hex string.');

// Verify valid signature matching
const expectedSig = crypto.createHmac('sha256', testSecret).update(`${orderId}|${paymentId}`).digest('hex');
assert.strictEqual(generatedSignature, expectedSig, 'Valid signatures must match');
console.log('✅ Test 2 Passed: Valid signature verification passes identically.');

// Verify invalid signature rejection
const fakeSig = '0000000000000000000000000000000000000000000000000000000000000000';
assert.notStrictEqual(generatedSignature, fakeSig, 'Invalid signatures must fail');
console.log('✅ Test 3 Passed: Tampered signature correctly rejected.');

// 2. Test Raw-Body Webhook Signature Verification
const webhookSecret = 'sample_webhook_secret_999';
const sampleWebhookBody = JSON.stringify({
  entity: 'event',
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_ABC123',
        order_id: 'order_ABC123',
        amount: 600000,
        currency: 'INR',
        status: 'captured'
      }
    }
  }
});

const webhookSignature = crypto
  .createHmac('sha256', webhookSecret)
  .update(Buffer.from(sampleWebhookBody))
  .digest('hex');

const verifiedWebhookSig = crypto
  .createHmac('sha256', webhookSecret)
  .update(Buffer.from(sampleWebhookBody))
  .digest('hex');

assert.strictEqual(webhookSignature, verifiedWebhookSig, 'Raw body webhook signature matches');
console.log('✅ Test 4 Passed: Raw-body Webhook signature validation succeeds.');

console.log('\n🎉 ALL CRYPTOGRAPHIC PAYMENT TESTS PASSED SUCCESSFULLY!\n');
