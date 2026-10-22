/**
 * SNS messages signed the way AWS signs them, with a key pair made for each test run, for the SES
 * notice tests. `testSnsCertificate` stands in for the certificate download: crypto.verify accepts
 * the public key in place of the certificate.
 */
import crypto from 'node:crypto';
import { snsStringToSign, type SnsMessage } from '@/lib/mail/events';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
export const testSnsPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const testSnsCertificate = async () => testSnsPublicKey;

export const SNS_CERT_URL = 'https://sns.ap-southeast-2.amazonaws.com/SimpleNotificationService-abc.pem';
export const SNS_TOPIC = 'arn:aws:sns:ap-southeast-2:123:ses-notices';

/** A message signed with SignatureVersion 2 (SHA256) or 1 (SHA1). */
export function signedSns(fields: Partial<SnsMessage>, version: '1' | '2' = '2'): SnsMessage {
  const message = {
    Type: 'Notification',
    MessageId: 'sns-1',
    TopicArn: SNS_TOPIC,
    Message: '{}',
    Timestamp: '2026-10-22T10:00:00.000Z',
    SignatureVersion: version,
    SigningCertURL: SNS_CERT_URL,
    Signature: '',
    ...fields,
  } as SnsMessage;
  message.Signature = crypto.sign(version === '2' ? 'sha256' : 'sha1', Buffer.from(snsStringToSign(message)), privateKey).toString('base64');
  return message;
}
