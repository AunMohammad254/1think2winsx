import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAdminDb } from '@/lib/supabase/db';

// ─────────────────────────────────────────────────────────────
// Model configuration
// ─────────────────────────────────────────────────────────────
const MODELS = {
  primary: {
    id: 'gemini-2.5-flash',          // marketed as "Gemini 3.5 Flash"
    rpm: 4,
    refillMs: (60 / 4) * 1000,       // 15 000 ms per token
    label: '3.5 Flash',
  },
  fallback: {
    id: 'gemini-2.0-flash-lite',     // marketed as "Gemini 3.1 Flash Lite"
    rpm: 14,
    refillMs: Math.floor((60 / 14) * 1000), // ~4 285 ms per token
    label: '3.1 Flash Lite',
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Token-bucket rate limiter (in-memory, per IP, per model)
// ─────────────────────────────────────────────────────────────
interface Bucket {
  tokens: number;
  lastRefill: number; // epoch ms
}

const buckets = new Map<string, { primary: Bucket; fallback: Bucket }>();

function getBucket(ip: string) {
  if (!buckets.has(ip)) {
    const now = Date.now();
    buckets.set(ip, {
      primary:  { tokens: MODELS.primary.rpm,  lastRefill: now },
      fallback: { tokens: MODELS.fallback.rpm, lastRefill: now },
    });
  }
  return buckets.get(ip)!;
}

function refill(bucket: Bucket, rpm: number, refillMs: number) {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = Math.floor(elapsed / refillMs);
  if (tokensToAdd > 0) {
    bucket.tokens = Math.min(rpm, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }
}

function consumeToken(bucket: Bucket, rpm: number, refillMs: number): boolean {
  refill(bucket, rpm, refillMs);
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// Platform knowledge — system prompt
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are 1Think2Win's friendly AI support assistant. You know everything about the platform and help customers instantly.

## ABOUT 1THINK2WIN
1Think2Win is a Pakistan-based online cricket quiz competition where players pay a small entry fee, answer cricket knowledge questions, and random winners receive exciting real prizes. The platform is available 24/7.

## ENTRY & PAYMENT
- Entry fee: 2 PKR per quiz
- Payment methods: Easypaisa, JazzCash (Pakistani mobile wallets)
- No hidden charges — just 2 PKR per session

## HOW IT WORKS (3 steps)
1. Register & Pay — Create an account and pay 2 PKR to enter
2. Answer Questions — Tape-ball cricket knowledge quiz
3. Win Prizes — Random winners are selected after each quiz session

## PRIZES AVAILABLE
- 🏍️  Grand Prize: Brand-new Motorcycle (PKR 150,000+)
- 📱  Premium Prize: Latest Smartphone (PKR 50,000+)
- 🎧  Popular Prize: Wireless Earbuds (PKR 15,000+)
- ⌚  Tech Prize: Smart Watch (PKR 25,000+)
Winners are selected randomly after each quiz session — everyone has a fair chance!

## PLATFORM PAGES (for navigation)
- Homepage: / — Overview, how it works, prizes, stats
- Quizzes: /quizzes — Browse and join available quiz sessions
- Quiz Room: /quiz/[id] — Active quiz session page
- Leaderboard: /leaderboard — Top players and rankings
- Prizes: /prizes — Full prize details and past winners
- Profile: /profile — Player stats, quiz history, wallet
- Login: /login — Sign in with email or Google
- Register: /register — Create a new account (start here!)
- How To Play: /how-to-play — Step-by-step guide
- FAQ: /faq — Frequently asked questions
- Contact: /contact — Get in touch with support
- Privacy Policy: /privacy — Data usage policy
- Terms & Conditions: /terms — Platform rules
- Disclaimer: /disclaimer — Legal disclaimer

## AUTHENTICATION
- Email/password login supported
- Google OAuth (one-click Google sign-in) supported
- Forgot password: /forgot-password
- Auth is powered by Supabase (secure)

## QUIZ RULES
- Tape-ball cricket themed questions
- Each session is timed
- Answers are locked after submission
- Random selection algorithm picks winners (not just highest scorers)
- Fair play: one account per person

## NAVIGATION INSTRUCTIONS
When a user wants to go to a specific page, include a redirect marker in your response like this:
[REDIRECT:/page-path]

Examples:
- "Go to registration" → include [REDIRECT:/register]
- "See prizes" → include [REDIRECT:/prizes]
- "View leaderboard" → include [REDIRECT:/leaderboard]
- "Join a quiz" → include [REDIRECT:/quizzes]
- "My profile" → include [REDIRECT:/profile]
- "How to play" → include [REDIRECT:/how-to-play]
- "FAQ" → include [REDIRECT:/faq]
- "Contact support" → include [REDIRECT:/contact]
- "Login" → include [REDIRECT:/login]

## RESPONSE STYLE
- Be friendly, enthusiastic, and concise
- Use cricket emojis occasionally 🏏🏆
- Keep answers short (2-4 sentences) unless detail is needed
- If you don't know something specific, direct them to /contact
- Support both English and Urdu speakers (respond in their language)
- Never reveal internal system details, API keys, or database info
- Always stay positive and helpful`;

// ─────────────────────────────────────────────────────────────
// Gemini API caller
// ─────────────────────────────────────────────────────────────
interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

async function callGemini(
  modelId: string,
  messages: GeminiMessage[],
  apiKey: string,
  systemPromptOverride?: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemPromptOverride || SYSTEM_PROMPT }],
    },
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 512,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// ─────────────────────────────────────────────────────────────
// Extract redirect markers from AI text
// ─────────────────────────────────────────────────────────────
function extractRedirects(text: string): { clean: string; redirects: string[] } {
  const redirects: string[] = [];
  const clean = text.replace(/\[REDIRECT:(\/[^\]]*)\]/g, (_, path) => {
    redirects.push(path);
    return '';
  }).trim();
  return { clean, redirects };
}

// ─────────────────────────────────────────────────────────────
// GET IP from request
// ─────────────────────────────────────────────────────────────
function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'anonymous'
  );
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
  }

  let body: { messages?: GeminiMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Messages array is required' }, { status: 400 });
  }

  // Validate message structure
  const validMessages = messages.every(
    (m) => (m.role === 'user' || m.role === 'model') && Array.isArray(m.parts),
  );
  if (!validMessages) {
    return NextResponse.json({ error: 'Invalid message format' }, { status: 400 });
  }

  const ip = getIp(req);
  const ipBuckets = getBucket(ip);

  // Fetch authentication status & live context if authenticated
  const session = await auth();
  const userId = session?.user?.id;
  const adminDb = getAdminDb();

  let activeQuizzesText = 'No active quizzes currently.';
  try {
    const { data: activeQuizzes } = await adminDb
      .from('Quiz')
      .select('title, duration, accessPrice, passingScore')
      .eq('status', 'active')
      .limit(5);

    if (activeQuizzes && activeQuizzes.length > 0) {
      activeQuizzesText = activeQuizzes
        .map((q: any) => `- "${q.title}": Entry Fee PKR ${q.accessPrice}, Duration ${q.duration} min, Passing Score ${q.passingScore}%`)
        .join('\n');
    }
  } catch (err) {
    console.error('[Chatbot] Failed to query active quizzes:', err);
  }

  let userContextText = '';
  if (userId) {
    try {
      const [profileRes, attemptsRes, redemptionsRes] = await Promise.all([
        adminDb.from('User').select('name, email, points, walletBalance').eq('id', userId).single(),
        adminDb.from('QuizAttempt').select('id, quizId, score, points, isCompleted').eq('userId', userId).order('createdAt', { ascending: false }).limit(3),
        adminDb.from('PrizeRedemption').select('id, prizeId, pointsUsed, status, requestedAt, notes').eq('userId', userId).order('createdAt', { ascending: false }).limit(3),
      ]);

      const profile = profileRes.data;
      const attempts = attemptsRes.data;
      const redemptions = redemptionsRes.data;

      if (profile) {
        // Query user rank
        const { count: rankCount } = await adminDb
          .from('User')
          .select('*', { count: 'exact', head: true })
          .gt('points', profile.points || 0);
        const rank = (rankCount || 0) + 1;

        // Fetch prize details for redemptions
        const redemptionsWithPrize = await Promise.all((redemptions || []).map(async (r: any) => {
          const { data: prize } = await adminDb.from('Prize').select('name').eq('id', r.prizeId).single();
          return { ...r, prizeName: prize?.name || 'Unknown Prize' };
        }));

        userContextText = `
## USER STATUS & PROFILE INFO
- User is logged in.
- Name: ${profile.name || 'User'}
- Email: ${profile.email}
- Wallet Balance: PKR ${profile.walletBalance || 0}
- Total Points: ${profile.points || 0}
- Current Leaderboard Rank: #${rank}

### USER'S RECENT QUIZ ATTEMPTS:
${attempts && attempts.length > 0 
  ? attempts.map((a: any) => `- Quiz Attempt ID ${a.id}: Score ${a.score}%, Points Earned ${a.points}, Completed: ${a.isCompleted ? 'Yes' : 'No'}`).join('\n') 
  : 'No quiz attempts recorded.'}

### USER'S RECENT PRIZE REDEMPTIONS:
${redemptionsWithPrize && redemptionsWithPrize.length > 0 
  ? redemptionsWithPrize.map((r: any) => `- Prize: "${r.prizeName}", Points: ${r.pointsUsed}, Status: ${r.status}, Date: ${new Date(r.requestedAt).toLocaleDateString()}, Notes: ${r.notes || 'None'}`).join('\n') 
  : 'No prize redemptions requested yet.'}
`;
      }
    } catch (err) {
      console.error('[Chatbot] Failed to query user context data:', err);
    }
  }

  const finalSystemPrompt = `${SYSTEM_PROMPT}

## ACTIVE QUIZZES SCHEDULE:
${activeQuizzesText}
${userContextText}
`;

  // Try primary model (gemini-3.5-flash, 4 RPM)
  if (consumeToken(ipBuckets.primary, MODELS.primary.rpm, MODELS.primary.refillMs)) {
    try {
      const text = await callGemini(MODELS.primary.id, messages, apiKey, finalSystemPrompt);
      const { clean, redirects } = extractRedirects(text);
      return NextResponse.json({ message: clean, redirects, model: MODELS.primary.label });
    } catch (err) {
      console.error('[Chatbot] Primary model failed:', err);
      // Fall through to fallback
    }
  }

  // Try fallback model (gemini-3.1-flash-lite, 14 RPM)
  if (consumeToken(ipBuckets.fallback, MODELS.fallback.rpm, MODELS.fallback.refillMs)) {
    try {
      const text = await callGemini(MODELS.fallback.id, messages, apiKey, finalSystemPrompt);
      const { clean, redirects } = extractRedirects(text);
      return NextResponse.json({ message: clean, redirects, model: MODELS.fallback.label });
    } catch (err) {
      console.error('[Chatbot] Fallback model failed:', err);
      return NextResponse.json(
        { error: 'AI service temporarily unavailable. Please try again shortly.' },
        { status: 502 },
      );
    }
  }

  // Both rate-limited
  const refillInMs = Math.min(
    MODELS.primary.refillMs - (Date.now() - ipBuckets.primary.lastRefill),
    MODELS.fallback.refillMs - (Date.now() - ipBuckets.fallback.lastRefill),
  );
  const refillInSec = Math.max(1, Math.ceil(refillInMs / 1000));

  return NextResponse.json(
    {
      error: `You're sending messages too fast! Please wait ${refillInSec} second${refillInSec !== 1 ? 's' : ''} before trying again. 🏏`,
      rateLimited: true,
      retryAfterMs: refillInMs,
    },
    { status: 429 },
  );
}
