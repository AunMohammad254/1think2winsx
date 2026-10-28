/**
 * Prize claim tracking, the parts both the browser and the server use (migration
 * 20261028120000_claim_tracking). The database makes every claim's tracking ID, such as
 * 1T2W-7K3M-QX97; this reads what people type and labels what the database reports. The handover
 * code is server-only: src/lib/claim-tracking.ts.
 */

// Crockford base32: no I, L, O or U, so no two characters look alike
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = '1T2W';

/**
 * The check character for the 7 random characters: Luhn mod 32, the same as
 * private_hardened.claim_tracking_check_char. Null when the body has a character outside the alphabet.
 */
export function trackingCheckChar(body: string): string | null {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    const code = ALPHABET.indexOf(body[i]);
    if (code < 0) return null;
    const addend = factor * code;
    sum += Math.floor(addend / 32) + (addend % 32);
    factor = 3 - factor;
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
}

/**
 * A tracking ID as stored (1T2W-XXXX-XXXX), or null when the text isn't one. Forgives what people do
 * when they copy one off a phone: lower case, spaces, missing dashes, a missing 1T2W, and O, I or L
 * typed for 0 or 1. A wrong character fails the check character.
 */
export function normalizeTrackingId(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length === 12 && s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  if (trackingCheckChar(s.slice(0, 7)) !== s[7]) return null;
  return `${PREFIX}-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** The handover code as shown to the winner: "482 913" */
export const formatHandoverCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskFlag {
  code: string;
  weight: number;
  /** Other accounts involved (shared_phone, shared_address, shared_ip) or other claims (many_claims) */
  count?: number;
  /** Up to 5 of those accounts' emails */
  accounts?: string[];
}

/** What private_hardened.claim_risk reports for a claim */
export interface ClaimRisk {
  score: number;
  level: RiskLevel;
  flags: RiskFlag[];
}

export const RISK_FLAG_LABELS: Record<string, string> = {
  shared_phone: 'WhatsApp number also used by other accounts',
  shared_address: 'Delivery address also used by other accounts',
  shared_ip: 'Sent from the same IP as other claimants (mobile networks share IPs, so weigh this lightly)',
  new_account: 'Account less than 7 days old when it claimed',
  many_claims: '3 or more other claims from this account in 30 days',
  phone_not_on_profile: "WhatsApp number isn't the phone on the profile",
};

/** A step in a claim's history as the winner sees it: no admins, IPs or risk details */
export interface PlayerClaimEvent {
  event: 'submitted' | 'approved' | 'rejected' | 'delivered' | 'reopened' | 'handover_failed' | 'code_reset';
  at: string;
  /** The admin's note, kept only for a rejection (the winner needs to know what to fix) */
  note?: string | null;
}

export const PLAYER_EVENT_LABELS: Record<PlayerClaimEvent['event'], string> = {
  submitted: 'Claim received',
  approved: 'Approved',
  rejected: 'Not approved',
  delivered: 'Delivered',
  reopened: 'Being sent again',
  handover_failed: 'A wrong handover code was entered',
  code_reset: 'Your handover code changed',
};

/** Shown next to every tracking ID the winner sees, so they can tell our messages from a scammer's */
export const ANTI_SCAM_NOTICE =
  'We never ask you to pay for a prize. Every message from 1Think2Win about it quotes this tracking ID. Give your handover code only to the person handing you the prize.';
