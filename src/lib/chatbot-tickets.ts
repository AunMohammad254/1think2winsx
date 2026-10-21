/**
 * Support tickets through the chatbot (POST /api/chatbot).
 *
 * The model asks for ticket work with markers in its reply, like [REDIRECT:/path]:
 *   [TICKET_CREATE:<one-line summary>]   send the player's problem to the admins
 *   [TICKET_STATUS:TKT-7KQ2XM]           look a ticket up ([TICKET_STATUS:ALL]: their latest ones)
 * The server strips the markers, does the database work for the signed-in player only, and adds
 * its own text with the ticket number or the status, so the model never makes up a number, a
 * status or an admin reply. A ticket number the player typed is looked up even when the model
 * forgot to ask for it.
 */
import { supportTicketDb } from '@/lib/supabase/db';
import {
  TICKET_MESSAGE_MAX,
  TICKET_STATUS_LABELS,
  TICKET_SUBJECT_MAX,
  findTicketNumbers,
  type SupportTicket,
} from '@/lib/support-tickets';

/** The player's latest tickets shown for [TICKET_STATUS:ALL] */
const MY_TICKETS_LIMIT = 5;

export function ticketPrompt(signedIn: boolean): string {
  if (!signedIn) {
    return `## SUPPORT TICKETS
The user is NOT signed in. Support tickets need an account: if they want to report a problem to the support team or check on a ticket, ask them to sign in first and include [REDIRECT:/login]. Never write TICKET markers.`;
  }
  return `## SUPPORT TICKETS
The user is signed in, so you can send a problem to the support team as a ticket, and check their tickets.
- When the user has a problem you can't solve (for example a missing deposit, a wrong score, a prize that didn't arrive, an account problem or a bug), offer to send it to the support team.
- Only when they agree, reply with one short sentence such as "Sending this to our support team now." plus the marker [TICKET_CREATE:<one-line summary of the problem in English, at most 100 characters, no square brackets>]. One ticket per problem.
- The system creates the ticket and adds the ticket number to your reply. Never make up a ticket number, and don't say the ticket was created: the system confirms it.
- When the user asks about a ticket or complaint, include [TICKET_STATUS:TKT-XXXXXX] with its number, or [TICKET_STATUS:ALL] when they ask about "my tickets" or don't know the number. The system adds the real status and the support team's reply below your message: don't guess them.`;
}

interface ChatTurn {
  role: string;
  parts: { text: string }[];
}

export interface TicketOutcome {
  /** The model's text without markers, plus what the server added */
  message: string;
  redirects: string[];
  /** Set when a ticket was created, so the chat can offer to copy it */
  ticketNumber?: string;
}

const CREATE_MARKER = /\[TICKET_CREATE:([^\]]*)\]/gi;
const STATUS_MARKER = /\[TICKET_STATUS:([^\]]*)\]/gi;

const SIGN_IN_TEXT = '🔒 Please sign in to send or check a support ticket. Tickets belong to your account, so only you can see yours.';
const UNAVAILABLE_TEXT = "⚠️ Sorry, I couldn't reach our support ticket system just now. Please try again in a few minutes.";

const turnText = (turn: ChatTurn) => turn.parts.map((p) => p.text).join(' ').trim();

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What the player said in this chat, newest last: the ticket's description for the admins */
function playerWords(history: ChatTurn[]): string {
  const said = history.filter((t) => t.role === 'user').map(turnText).filter(Boolean).join('\n\n');
  return said.length > TICKET_MESSAGE_MAX ? `…${said.slice(-(TICKET_MESSAGE_MAX - 1))}` : said;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });

function describeTicket(ticket: SupportTicket): string {
  return [
    `🎫 ${ticket.ticketNumber}: "${ticket.subject}"`,
    `Status: ${TICKET_STATUS_LABELS[ticket.status]}`,
    ticket.adminReply ? `Reply from our support team: ${ticket.adminReply}` : 'No reply from our support team yet.',
    `Sent ${formatDate(ticket.createdAt)} · Last updated ${formatDate(ticket.updatedAt)}`,
  ].join('\n');
}

/**
 * Carries out the ticket markers in a model reply for `userId` (undefined: a guest) and returns
 * the text to show. Never throws: a database failure becomes an apology in the reply.
 */
export async function handleTicketRequests(reply: string, ctx: { userId?: string; history: ChatTurn[] }): Promise<TicketOutcome> {
  const create = reply.match(new RegExp(CREATE_MARKER.source, 'i')); // one ticket per reply
  const summary = create ? create[1].trim() : null;
  let wantsMine = false;
  const asked: string[] = [];
  for (const [, arg] of reply.matchAll(STATUS_MARKER)) {
    if (arg.trim().toUpperCase() === 'ALL') wantsMine = true;
    else asked.push(...findTicketNumbers(arg));
  }
  const text = reply.replace(CREATE_MARKER, '').replace(STATUS_MARKER, '').trim();
  const withText = (...blocks: string[]) => [text, ...blocks].filter(Boolean).join('\n\n');

  if (!ctx.userId) {
    const wantsTickets = summary !== null || wantsMine || asked.length > 0;
    return wantsTickets ? { message: withText(SIGN_IN_TEXT), redirects: ['/login'] } : { message: text, redirects: [] };
  }

  const latest = ctx.history.filter((t) => t.role === 'user').map(turnText).at(-1) ?? '';
  const numbers = [...new Set([...asked, ...findTicketNumbers(latest)])];
  if (summary === null && !wantsMine && numbers.length === 0) return { message: text, redirects: [] };

  const blocks: string[] = [];
  let ticketNumber: string | undefined;
  try {
    if (summary !== null) {
      // The model's summary, or the player's last message when the marker came without one
      const subject = clip((summary || latest).replace(/\s+/g, ' '), TICKET_SUBJECT_MAX);
      const created = await supportTicketDb.create(ctx.userId, subject, playerWords(ctx.history));
      if (created.success) {
        ticketNumber = created.ticket.ticketNumber;
        blocks.push(
          `🎫 Your ticket number is ${ticketNumber}. Our support team has it now.\n` +
            `Please save this number: ask me about ${ticketNumber} any time to see its status and our team's reply.`,
        );
      } else {
        blocks.push(`⚠️ ${created.error}`);
      }
    }
    if (numbers.length > 0) {
      const found = await supportTicketDb.findForUser(ctx.userId, numbers);
      for (const number of numbers) {
        const ticket = found.find((t) => t.ticketNumber === number);
        blocks.push(ticket ? describeTicket(ticket) : `I couldn't find ticket ${number} on your account. Please check the number (it looks like TKT-7KQ2XM).`);
      }
    }
    if (wantsMine) {
      const mine = await supportTicketDb.listForUser(ctx.userId, MY_TICKETS_LIMIT);
      blocks.push(
        mine.length > 0
          ? ['Your latest support tickets:', ...mine.map(describeTicket)].join('\n\n')
          : "You haven't sent any support tickets yet. Tell me about the problem and I can send it to our support team.",
      );
    }
  } catch (err) {
    console.error('[Chatbot] Support ticket request failed:', err);
    blocks.push(UNAVAILABLE_TEXT);
  }
  return { message: withText(...blocks), redirects: [], ...(ticketNumber ? { ticketNumber } : {}) };
}
