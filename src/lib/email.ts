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
 * Helper function to wrap emails in a beautiful HTML template.
 */
export const generateBeautifulEmailTemplate = (title: string, messageHtml: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { margin: 0; padding: 0; font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #09090b; color: #ffffff; }
        .container { max-width: 600px; margin: 40px auto; background: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
        .header { background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%); padding: 30px; text-align: center; }
        .header h1 { margin: 0; color: #000000; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
        .content { padding: 40px 30px; }
        .content p { color: #a1a1aa; font-size: 16px; line-height: 1.6; margin-top: 0; margin-bottom: 20px; }
        .content h2 { color: #ffffff; font-size: 20px; margin-top: 0; margin-bottom: 15px; font-weight: 600; }
        .footer { padding: 20px; text-align: center; border-top: 1px solid #27272a; background: #09090b; }
        .footer p { color: #52525b; font-size: 12px; margin: 0; }
        .button { display: inline-block; background: #eab308; color: #000000; font-weight: 600; text-decoration: none; padding: 12px 24px; rounded: 8px; margin-top: 10px; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>1Think 2Win</h1>
        </div>
        <div class="content">
            <h2>${title}</h2>
            ${messageHtml}
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} 1Think 2Win. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;
