/**
 * 1Think 2Win email design kit.
 *
 * Every email the product sends (our own transactional emails, the newsletter and the Supabase auth
 * emails) is built from these pieces so they all look like the app: deep navy "ink" backgrounds,
 * emerald as the action colour, amber as the accent, and the "1T" mark from the navbar.
 *
 * Email-client rules this follows (so it renders in Gmail, Outlook and Apple Mail):
 *  - table layout with inline styles; the <style> block only adds mobile tweaks (nice to have, never required)
 *  - no images, web fonts or scripts: the logo is built from a table cell, fonts fall back safely
 *  - solid colours only (gradients are not reliable); `bgcolor` attributes repeat the background colours
 *  - every interpolated value goes through escapeHtml; Supabase `{{ .Placeholder }}` text passes through unchanged
 *
 * Pure functions with no side effects, so they are easy to test and to reuse in build scripts.
 */
import { siteUrl } from './site-url';

/** Palette taken from the app (src/app/globals.css: ink-950/900/800, emerald, gold). */
export const EMAIL_COLORS = {
    pageBg: '#050814', // ink-950
    cardBg: '#0b0f19', // ink-900
    panelBg: '#121826', // ink-800
    border: '#1e293b',
    heading: '#ffffff',
    text: '#cbd5e1',
    muted: '#94a3b8',
    faint: '#64748b',
    emerald: '#10b981',
    emeraldSoft: '#34d399',
    amber: '#f59e0b',
    amberSoft: '#fbbf24',
    onEmerald: '#050814', // dark text on the emerald button (contrast 7:1)
} as const;

/** Poppins is the app's heading font; clients without it fall back to the system sans-serif. */
export const EMAIL_FONT = "Poppins,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const C = EMAIL_COLORS;

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** A bulletproof pill button. `href` may be a Supabase placeholder such as {{ .ConfirmationURL }}. */
export function emailButton(href: string, label: string, opts: { variant?: 'primary' | 'secondary' } = {}): string {
    const primary = opts.variant !== 'secondary';
    const bg = primary ? C.emerald : C.panelBg;
    const fg = primary ? C.onEmerald : C.heading;
    const border = primary ? C.emerald : C.border;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" style="margin:8px 8px 8px 0;display:inline-table;">
  <tr>
    <td align="center" bgcolor="${bg}" style="background-color:${bg};border:1px solid ${border};border-radius:999px;">
      <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${EMAIL_FONT};font-size:16px;line-height:20px;font-weight:700;color:${fg};text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

/** A normal paragraph. `html` is trusted markup (escape user text before passing it in). */
export function emailParagraph(html: string, opts: { muted?: boolean; small?: boolean } = {}): string {
    const color = opts.muted ? C.muted : C.text;
    const size = opts.small ? '13px' : '16px';
    return `<p style="margin:0 0 16px 0;font-family:${EMAIL_FONT};font-size:${size};line-height:1.65;color:${color};">${html}</p>`;
}

/** A highlighted callout (amber for cautions, emerald for good news). */
export function emailNote(html: string, tone: 'amber' | 'emerald' = 'amber'): string {
    const accent = tone === 'amber' ? C.amber : C.emerald;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;">
  <tr>
    <td bgcolor="${C.panelBg}" style="background-color:${C.panelBg};border:1px solid ${C.border};border-left:4px solid ${accent};border-radius:10px;padding:14px 16px;font-family:${EMAIL_FONT};font-size:14px;line-height:1.6;color:${C.text};">${html}</td>
  </tr>
</table>`;
}

/** "If the button doesn't work" fallback with the raw link. */
export function emailLinkFallback(url: string): string {
    return `<p style="margin:20px 0 6px 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:${C.faint};">If the button doesn&#39;t work, copy and paste this link into your browser:</p>
<p style="margin:0 0 8px 0;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.5;color:${C.emeraldSoft};word-break:break-all;"><a href="${escapeHtml(url)}" target="_blank" style="color:${C.emeraldSoft};text-decoration:underline;">${escapeHtml(url)}</a></p>`;
}

/** A prominent value in a panel, e.g. the person's sign-in email address. */
export function emailValue(text: string): string {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;">
  <tr>
    <td bgcolor="${C.panelBg}" style="background-color:${C.panelBg};border:1px solid ${C.border};border-radius:12px;padding:16px 20px;font-family:${EMAIL_FONT};font-size:18px;line-height:26px;font-weight:700;color:${C.emeraldSoft};overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(text)}</td>
  </tr>
</table>`;
}

/** A large one-time code (for the reauthentication email). */
export function emailCode(code: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;">
  <tr>
    <td bgcolor="${C.panelBg}" style="background-color:${C.panelBg};border:1px solid ${C.border};border-radius:12px;padding:16px 28px;font-family:Consolas,Menlo,monospace;font-size:32px;line-height:36px;letter-spacing:8px;font-weight:700;color:${C.amberSoft};">${escapeHtml(code)}</td>
  </tr>
</table>`;
}

export interface EmailShellOptions {
    /** Heading shown at the top of the card (also the <title>) */
    title: string;
    /** Inbox preview text (the grey line after the subject) */
    preheader?: string;
    /** Trusted HTML for the body: compose it from the helpers above */
    bodyHtml: string;
    /** Small print under the card, e.g. why the person got this email. Trusted HTML. */
    footerNoteHtml?: string;
    /** Site root for the footer links; defaults to NEXT_PUBLIC_SITE_URL. Supabase templates pass {{ .SiteURL }}. */
    baseUrl?: string;
    /** Copyright year in the footer. Defaults to the current year; pass null to omit it (for templates pasted into a dashboard, where a baked-in year would go stale). */
    year?: number | null;
}

/** The full branded email document. */
export function emailShell(opts: EmailShellOptions): string {
    const base = (opts.baseUrl ?? siteUrl()).replace(/\/+$/, '');
    const preheader = opts.preheader ? escapeHtml(opts.preheader) : '';
    const year = opts.year === undefined ? new Date().getFullYear() : opts.year;
    const link = (path: string, label: string) =>
        `<a href="${base}${path}" target="_blank" style="color:${C.muted};text-decoration:underline;">${label}</a>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(opts.title)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .h1 { font-size: 24px !important; line-height: 30px !important; }
    table.btn { display: table !important; width: 100% !important; margin-right: 0 !important; }
    table.btn td { width: 100% !important; }
    table.btn a { display: block !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.pageBg};" bgcolor="${C.pageBg}">
${preheader ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.pageBg};">${preheader}${'&#847;&zwnj;&nbsp;'.repeat(20)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.pageBg}" style="background-color:${C.pageBg};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr>
          <td bgcolor="${C.cardBg}" style="background-color:${C.cardBg};border:1px solid ${C.border};border-radius:20px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td height="4" width="65%" bgcolor="${C.emerald}" style="height:4px;line-height:4px;font-size:4px;background-color:${C.emerald};">&nbsp;</td>
                <td height="4" width="35%" bgcolor="${C.amber}" style="height:4px;line-height:4px;font-size:4px;background-color:${C.amber};">&nbsp;</td>
              </tr>
              <tr>
                <td colspan="2" class="px" style="padding:28px 40px 4px 40px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="44" height="44" align="center" valign="middle" bgcolor="${C.emerald}" style="width:44px;height:44px;background-color:${C.emerald};border-radius:12px;font-family:${EMAIL_FONT};font-size:19px;font-weight:800;line-height:44px;color:${C.onEmerald};">1T</td>
                      <td style="padding-left:12px;font-family:${EMAIL_FONT};">
                        <div style="font-size:19px;line-height:22px;font-weight:700;color:${C.heading};">1Think 2Win</div>
                        <div style="font-size:10px;line-height:14px;letter-spacing:2px;color:${C.muted};">SPORTS EXCELLENCE</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td colspan="2" class="px" style="padding:24px 40px 8px 40px;">
                  <h1 class="h1" style="margin:0 0 18px 0;font-family:${EMAIL_FONT};font-size:28px;line-height:34px;font-weight:700;color:${C.heading};">${escapeHtml(opts.title)}</h1>
                  <div style="font-family:${EMAIL_FONT};font-size:16px;line-height:1.65;color:${C.text};">
${opts.bodyHtml}
                  </div>
                </td>
              </tr>
              <tr>
                <td colspan="2" class="px" style="padding:20px 40px 28px 40px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="border-top:1px solid ${C.border};padding-top:18px;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:${C.faint};">
                        ${opts.footerNoteHtml ? `<div style="margin-bottom:10px;">${opts.footerNoteHtml}</div>` : ''}
                        <div>${link('/quizzes', 'Quizzes')} &nbsp;&middot;&nbsp; ${link('/prizes', 'Prizes')} &nbsp;&middot;&nbsp; ${link('/contact', 'Contact')}</div>
                        <div style="margin-top:6px;">&copy; ${year ? year + ' ' : ''}1Think 2Win. Think Smart. Play Hard. Win Big.</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}
