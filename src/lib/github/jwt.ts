import crypto from 'crypto';

/**
 * Encodes a string to base64url format.
 */
function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

/**
 * Generates an RS256 JWT signed with the GitHub App's private key.
 * Used to authenticate as the GitHub App to request installation access tokens.
 * 
 * @param appId The GitHub App ID (iss claim)
 * @param privateKeyPem The RSA private key in PEM format
 * @returns Signed JWT string
 */
export function generateAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    // Issued 60 seconds in the past to compensate for clock drift
    iat: now - 60,
    // Expires in 9 minutes (GitHub allows max 10 minutes)
    exp: now + 540,
    // GitHub App ID
    iss: appId,
  };

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const tokenInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  // Sign using Node.js crypto library
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(tokenInput);
  
  // Sign the token input with the private key and output base64url signature directly
  const signature = signer.sign(privateKeyPem, 'base64url');

  return `${tokenInput}.${signature}`;
}
