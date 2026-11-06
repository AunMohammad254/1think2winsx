/**
 * The address players write to: the contact page, the footer, the legal pages and every email's
 * Reply-To. Emails are still SENT from an @1think2win.com address (BREVO_SENDER_EMAIL), because that
 * is the only domain verified with SES, Brevo and Cloudflare; replies land here instead.
 * No server imports: client pages read it too.
 */
export const CONTACT_EMAIL = '1think2wins@gmail.com';

export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
