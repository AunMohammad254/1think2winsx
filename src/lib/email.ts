import { emailShell } from './email-theme';

export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export const sendEmail = async ({ to, subject, html, text }: SendEmailOptions) => {
    try {
        // 1. Prefer BREVO_API_KEY (set in both .env files, same as email-service.ts); fall back to
        // the legacy base64-encoded JSON key, whose hyphenated name hosting panels can't set.
        let apiKey: string | undefined = process.env.BREVO_API_KEY;
        if (!apiKey) {
            const base64Key = process.env['Bravo-MCP-API-key'];
            if (!base64Key) {
                throw new Error("Missing BREVO_API_KEY in environment");
            }
            apiKey = JSON.parse(Buffer.from(base64Key, 'base64').toString('utf-8')).api_key as string;
        }

        // 3. Use Brevo's REST API (bypassing SMTP which had authentication failures)
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    // Must be a verified sender (or authenticated domain) in Brevo, or the send is rejected
                    email: process.env.BREVO_SENDER_EMAIL || 'support@1think2win.com',
                    name: '1Think 2Win Support'
                },
                to: [{ email: to }],
                subject: subject,
                htmlContent: html,
                textContent: text || "Please use an HTML compatible email client."
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('Brevo API Error:', errData);
            throw new Error(errData.message || 'Failed to send email via Brevo REST API');
        }

        const data = await response.json();
        console.log('Message sent via Brevo API: %s', data.messageId);
        
        return { success: true, messageId: data.messageId };
    } catch (error: any) {
        console.error('Error sending email via Brevo API:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Wraps an email body in the shared 1Think 2Win layout (see ./email-theme).
 * Kept so existing callers keep working; new emails should use the builders in ./email-templates.
 * `title` is escaped; `messageHtml` is trusted markup.
 */
export const generateBeautifulEmailTemplate = (title: string, messageHtml: string) =>
    emailShell({ title, bodyHtml: messageHtml });
