export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends an email using the configured provider, falling back to a console mock logger.
 * 
 * @param payload Email details (to, subject, html body)
 * @returns boolean indicating if the delivery request succeeded
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const provider = process.env.EMAIL_PROVIDER;
  const apiKey = process.env.EMAIL_API_KEY;

  console.log(`[Email Service] Queueing message for delivery to ${payload.to}`);

  if (!provider || provider === 'none' || !apiKey) {
    console.log('--- SIMULATED EMAIL DELIVERED (MOCK PROVIDER) ---');
    console.log(`To: ${payload.to}`);
    console.log(`Subject: ${payload.subject}`);
    console.log(`Body (HTML length): ${payload.html.length} chars`);
    console.log('--------------------------------------------------');
    return true;
  }

  if (provider === 'resend') {
    try {
      const fromEmail = process.env.EMAIL_FROM || 'briefs@repobutler.dev';
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: `RepoButler <${fromEmail}>`,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Resend API returned error status ${response.status}: ${errorText}`);
        return false;
      }

      const resData = await response.json();
      console.log(`Resend email sent successfully. ID: ${resData.id}`);
      return true;
    } catch (err) {
      console.error('Error delivering email via Resend API:', err);
      return false;
    }
  }

  console.warn(`Unknown email provider "${provider}". Falling back to mock logger.`);
  return true;
}
