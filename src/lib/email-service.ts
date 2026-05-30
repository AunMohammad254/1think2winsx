/**
 * Email Dispatch Service
 * Utility for sending emails via Brevo SMTP HTTP API
 */

interface SendEmailParams {
  senderEmail: string;
  senderName?: string;
  subject: string;
  content: string;
  recipients: string[];
}

export async function sendNewsletterEmail({
  senderEmail,
  senderName = '1Think 2Win',
  subject,
  content,
  recipients
}: SendEmailParams): Promise<{ success: boolean; sentCount: number; error?: string }> {
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      throw new Error('BREVO_API_KEY is not configured in environment variables');
    }

    if (!recipients || recipients.length === 0) {
      return { success: true, sentCount: 0 };
    }

    // Format content with standard HTML wrapper
    const htmlContent = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0c0f1d; border: 1px solid #1e293b; border-radius: 12px; color: #f8fafc;">
        <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
          <h1 style="color: #3b82f6; margin: 0; font-size: 24px; font-weight: bold; background: linear-gradient(to right, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
            1Think 2Win
          </h1>
          <p style="color: #94a3b8; font-size: 12px; margin: 4px 0 0 0;">Think Smart, Win Big</p>
        </div>
        <div style="font-size: 16px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px; white-space: pre-line;">
          ${content}
        </div>
        <div style="border-top: 1px solid #1e293b; padding-top: 16px; text-align: center; font-size: 11px; color: #64748b;">
          <p style="margin: 0 0 8px 0;">You received this email because you subscribed to updates on 1Think 2Win.</p>
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} 1Think 2Win. All rights reserved.</p>
        </div>
      </div>
    `;

    // BCC all recipients to keep email addresses hidden and secure, and send TO senderEmail
    const bccList = recipients.map(email => ({ email }));

    const payload = {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: senderEmail, name: senderName }], // Sent to self so it triggers
      bcc: bccList,
      subject: subject,
      htmlContent: htmlContent
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Brevo API error response:', errBody);
      throw new Error(`Brevo API failed with status ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    console.log('Brevo API response:', data);

    return {
      success: true,
      sentCount: recipients.length
    };
  } catch (error: any) {
    console.error('Error dispatching newsletter email:', error);
    return {
      success: false,
      sentCount: 0,
      error: error.message || 'Unknown email dispatch error'
    };
  }
}
