import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../src/lib/security/webhooks';

describe('Webhook Security Verification', () => {
  const secret = 'webhook-secret-key';
  // Expected SHA256 HMAC signature of "test-payload" with key "webhook-secret-key"
  // calculated via: crypto.createHmac('sha256', 'webhook-secret-key').update('test-payload').digest('hex')
  // signature prefix: "sha256=17df20..."
  const payload = 'test-payload';
  const expectedSignature = 'sha256=efff326dca8461c8d071092ba4f4fa8646c93e61619d18fa5adea68837e5c2bf';

  it('verifies correct signatures successfully', () => {
    const isValid = verifyWebhookSignature(payload, expectedSignature, secret);
    expect(isValid).toBe(true);
  });

  it('rejects incorrect signatures', () => {
    const isInvalid = verifyWebhookSignature(payload, 'sha256=invalid-signature-hash-code', secret);
    expect(isInvalid).toBe(false);
  });

  it('rejects empty signatures or secrets gracefully', () => {
    expect(verifyWebhookSignature(payload, '', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, expectedSignature, '')).toBe(false);
  });

  it('handles length mismatches without throwing errors', () => {
    // Timing safe equal could throw error if length is different, check if our helper safe guards
    const checkLengthMismatch = () => verifyWebhookSignature(payload, 'sha256=short', secret);
    expect(checkLengthMismatch).not.toThrow();
    expect(checkLengthMismatch()).toBe(false);
  });
});
