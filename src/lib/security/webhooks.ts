import crypto from 'crypto';

/**
 * Verifies that a GitHub webhook payload matches the signature sent in the x-hub-signature-256 header.
 * Uses timingSafeEqual to guard against timing attacks.
 * 
 * @param payload Raw string payload of the request
 * @param signature Value of the x-hub-signature-256 header
 * @param secret The webhook secret configured on the GitHub App
 * @returns boolean indicating if the signature is valid
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) {
    return false;
  }
  
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  const digestBuffer = Buffer.from(digest);
  const signatureBuffer = Buffer.from(signature);
  
  if (digestBuffer.length !== signatureBuffer.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(digestBuffer, signatureBuffer);
}
