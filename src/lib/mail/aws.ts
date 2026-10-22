import { AwsClient } from 'aws4fetch';

/**
 * AWS access for the mail layer: one IAM user's access key (AWS_SES_ACCESS_KEY_ID /
 * AWS_SES_SECRET_ACCESS_KEY, set in hPanel), allowed only ses:SendEmail, ses:GetAccount,
 * ce:GetCostAndUsage and ce:GetCostForecast. Requests are signed with aws4fetch and sent over HTTPS.
 *
 * The AWS project (new AWS experience) is fixed to Sydney, so SES lives there; Cost Explorer only
 * answers in us-east-1.
 */
export const DEFAULT_SES_REGION = 'ap-southeast-2';

export function sesRegion(): string {
  return process.env.AWS_SES_REGION?.trim() || DEFAULT_SES_REGION;
}

function credentials(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY?.trim();
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

/** True when the SES access key is set, so Amazon SES can be selected. */
export function sesConfigured(): boolean {
  return credentials() !== null;
}

/** A signing client, or null when no access key is set. Never retries by itself: callers decide. */
export function awsClient(service: 'ses' | 'ce', region: string): AwsClient | null {
  const creds = credentials();
  return creds ? new AwsClient({ ...creds, service, region, retries: 0 }) : null;
}

/**
 * The error type and message from an AWS JSON error response. The type is in the
 * x-amzn-ErrorType header ("ThrottlingException:http://…") or in the body's __type / code.
 */
export async function awsError(response: Response): Promise<{ type: string; message: string }> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = response.headers.get('x-amzn-errortype') || String(body.__type ?? body.code ?? body.Code ?? '');
  const type = raw.split(':')[0].split('#').pop() || `HTTP ${response.status}`;
  const message = String(body.message ?? body.Message ?? '');
  return { type, message };
}
