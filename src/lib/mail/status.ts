import { getAdminDb } from '@/lib/supabase/db';
import { awsClient, awsError, sesRegion } from './aws';
import { brevoApiKey } from './providers/brevo';

/**
 * What the admin Email services page shows about each service: the SES sending quota, Brevo's plan
 * and credits, and the AWS bill this month. Each lookup is cached; Cost Explorer charges $0.01 per
 * request, so its result is kept for a day (in AppSettings, shared by every server) and a manual
 * refresh is allowed once an hour.
 */
export type Lookup<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SesAccount {
  max24HourSend: number;
  maxSendRate: number;
  sentLast24Hours: number;
  productionAccess: boolean;
  sendingEnabled: boolean;
  enforcementStatus: string | null;
}

export interface BrevoPlan {
  type: string;
  credits: number | null;
  creditsType: string | null;
  endDate: string | null;
}

export interface AwsCost {
  /** Cost this month up to yesterday (AWS updates it about once a day) */
  monthToDate: { amount: number; unit: string; estimated: boolean };
  /** AWS's forecast for the rest of the month; null until AWS has enough history */
  forecastRest: { amount: number; unit: string } | null;
  fetchedAt: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
const SES_TTL_MS = 5 * 60_000;
const BREVO_TTL_MS = 60 * 60_000;
export const COST_TTL_MS = 24 * 60 * 60_000;
export const COST_REFRESH_GAP_MS = 60 * 60_000;
const COST_KEY = 'aws_cost_cache';

let sesCache: { value: Lookup<SesAccount>; at: number } | null = null;
let brevoCache: { value: Lookup<BrevoPlan[]>; at: number } | null = null;
// A failed Cost Explorer lookup isn't repeated on every page view (each try costs $0.02)
let costFailure: { error: string; at: number } | null = null;

/** For tests and after a change that should show at once. */
export function clearStatusCaches(): void {
  sesCache = null;
  brevoCache = null;
  costFailure = null;
}

const message = (error: unknown) => (error as Error).message || String(error);

/** SES GetAccount in the configured region; null when SES has no access key. */
export async function getSesAccount(now = Date.now()): Promise<Lookup<SesAccount> | null> {
  const region = sesRegion();
  const client = awsClient('ses', region);
  if (!client) return null;
  if (sesCache && now - sesCache.at < SES_TTL_MS) return sesCache.value;

  let value: Lookup<SesAccount>;
  try {
    const response = await client.fetch(`https://email.${region}.amazonaws.com/v2/email/account`, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const { type, message: text } = await awsError(response);
      value = { ok: false, error: text ? `${type}: ${text}` : type };
    } else {
      const data = await response.json();
      value = {
        ok: true,
        data: {
          max24HourSend: Number(data.SendQuota?.Max24HourSend ?? 0),
          maxSendRate: Number(data.SendQuota?.MaxSendRate ?? 0),
          sentLast24Hours: Number(data.SendQuota?.SentLast24Hours ?? 0),
          productionAccess: data.ProductionAccessEnabled === true,
          sendingEnabled: data.SendingEnabled !== false,
          enforcementStatus: data.EnforcementStatus ?? null,
        },
      };
    }
  } catch (error) {
    value = { ok: false, error: `AWS SES could not be reached: ${message(error)}` };
  }
  sesCache = { value, at: now };
  return value;
}

/** Brevo's plan(s) and credits left; null when no Brevo API key is set. */
export async function getBrevoPlans(now = Date.now()): Promise<Lookup<BrevoPlan[]> | null> {
  const apiKey = brevoApiKey();
  if (!apiKey) return null;
  if (brevoCache && now - brevoCache.at < BREVO_TTL_MS) return brevoCache.value;

  let value: Lookup<BrevoPlan[]>;
  try {
    const response = await fetch('https://api.brevo.com/v3/account', {
      headers: { accept: 'application/json', 'api-key': apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    value = response.ok
      ? {
          ok: true,
          data: (Array.isArray(data.plan) ? data.plan : []).map((p: Record<string, unknown>) => ({
            type: String(p.type ?? 'unknown'),
            credits: typeof p.credits === 'number' ? p.credits : null,
            creditsType: typeof p.creditsType === 'string' ? p.creditsType : null,
            endDate: typeof p.endDate === 'string' ? p.endDate : null,
          })),
        }
      : { ok: false, error: `Brevo answered ${response.status}: ${data.message || 'no reason given'}` };
  } catch (error) {
    value = { ok: false, error: `Brevo could not be reached: ${message(error)}` };
  }
  brevoCache = { value, at: now };
  return value;
}

/** First day of this month, today, and the first day of next month, as YYYY-MM-DD in UTC. */
export function costPeriod(now: Date): { monthStart: string; today: string; nextMonth: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return { monthStart: day(new Date(Date.UTC(y, m, 1))), today: day(now), nextMonth: day(new Date(Date.UTC(y, m + 1, 1))) };
}

class AwsCallError extends Error {
  constructor(readonly type: string, text: string) {
    super(text ? `${type}: ${text}` : type);
  }
}

async function costExplorer(client: NonNullable<ReturnType<typeof awsClient>>, action: string, body: unknown) {
  const response = await client.fetch('https://ce.us-east-1.amazonaws.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSInsightsIndexService.${action}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const { type, message: text } = await awsError(response);
    throw new AwsCallError(type, text);
  }
  return response.json();
}

/** Two Cost Explorer requests ($0.02): cost this month so far, and the forecast for the rest. */
async function fetchAwsCost(client: NonNullable<ReturnType<typeof awsClient>>, now: Date): Promise<AwsCost> {
  const { monthStart, today, nextMonth } = costPeriod(now);

  // On the 1st there is nothing to count yet (the end date is exclusive)
  let monthToDate: AwsCost['monthToDate'] = { amount: 0, unit: 'USD', estimated: true };
  if (today !== monthStart) {
    const usage = await costExplorer(client, 'GetCostAndUsage', {
      TimePeriod: { Start: monthStart, End: today },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
    });
    const first = usage.ResultsByTime?.[0];
    monthToDate = {
      amount: Number(first?.Total?.UnblendedCost?.Amount ?? 0),
      unit: first?.Total?.UnblendedCost?.Unit ?? 'USD',
      estimated: first?.Estimated !== false,
    };
  }

  let forecastRest: AwsCost['forecastRest'] = null;
  try {
    const forecast = await costExplorer(client, 'GetCostForecast', {
      TimePeriod: { Start: today, End: nextMonth },
      Metric: 'UNBLENDED_COST',
      Granularity: 'MONTHLY',
    });
    forecastRest = { amount: Number(forecast.Total?.Amount ?? 0), unit: forecast.Total?.Unit ?? 'USD' };
  } catch (error) {
    // A new account has no forecast until AWS has enough history
    if (!(error instanceof AwsCallError) || error.type !== 'DataUnavailableException') throw error;
  }

  return { monthToDate, forecastRest, fetchedAt: now.toISOString() };
}

export interface AwsCostView {
  configured: boolean;
  cost: AwsCost | null;
  error: string | null;
  /** When the Refresh button works again (null when it works now) */
  refreshAvailableAt: string | null;
}

async function readCostCache(): Promise<AwsCost | null> {
  const { data, error } = await getAdminDb().from('AppSettings').select('value').eq('key', COST_KEY).maybeSingle();
  if (error) throw error;
  if (!data?.value) return null;
  try {
    const parsed = JSON.parse(data.value) as AwsCost;
    return parsed && typeof parsed.fetchedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCostCache(cost: AwsCost): Promise<void> {
  const { error } = await getAdminDb().from('AppSettings').upsert({
    key: COST_KEY,
    value: JSON.stringify(cost),
    description: 'Last AWS Cost Explorer result for the admin Email services page (refreshed at most once a day, or hourly by hand).',
    updatedAt: new Date().toISOString(),
  });
  if (error) throw error;
}

/**
 * AWS cost this month, from the day-old cache unless it is older than a day; refresh = true asks for
 * a new lookup, allowed once an hour.
 */
export async function getAwsCost({ refresh = false, now = new Date() }: { refresh?: boolean; now?: Date } = {}): Promise<AwsCostView> {
  const client = awsClient('ce', 'us-east-1');
  if (!client) return { configured: false, cost: null, error: null, refreshAvailableAt: null };

  try {
    const cached = await readCostCache();
    const age = cached ? now.getTime() - Date.parse(cached.fetchedAt) : Infinity;
    const nextRefresh = cached ? new Date(Date.parse(cached.fetchedAt) + COST_REFRESH_GAP_MS).toISOString() : null;
    if (cached && (refresh ? age < COST_REFRESH_GAP_MS : age < COST_TTL_MS)) {
      return { configured: true, cost: cached, error: null, refreshAvailableAt: age < COST_REFRESH_GAP_MS ? nextRefresh : null };
    }
    if (!refresh && costFailure && now.getTime() - costFailure.at < COST_REFRESH_GAP_MS) {
      return { configured: true, cost: cached, error: costFailure.error, refreshAvailableAt: null };
    }

    const cost = await fetchAwsCost(client, now);
    await saveCostCache(cost);
    costFailure = null;
    return { configured: true, cost, error: null, refreshAvailableAt: new Date(now.getTime() + COST_REFRESH_GAP_MS).toISOString() };
  } catch (error) {
    const text = `AWS billing could not be read: ${message(error)}`;
    costFailure = { error: text, at: now.getTime() };
    return { configured: true, cost: null, error: text, refreshAvailableAt: null };
  }
}
