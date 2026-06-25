import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Per-meeting envelope encryption for crypto-shredding: each meeting has its own data
// key. Destroying that key makes every line stored under it permanently unreadable -
// "provable absence" without touching (or trusting deletion of) the stored documents.

export type Enc = { ct: string; iv: string; tag: string };

export function genKey(): string {
  return randomBytes(32).toString('base64'); // AES-256 key
}

export function encrypt(plain: string, keyB64: string): Enc {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return {
    ct: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
  };
}

export function decrypt(enc: Enc, keyB64: string): string {
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'),
    Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc.ct, 'base64')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// KMS-wrapped keys (envelope encryption) - ENV-GATED, off by default.
//
// What's stored in MeetingKey.key is always a base64 string. The `wrapped` flag
// tells us how to interpret it:
//   - wrapped:false (DEFAULT, no KMS_KEY_ID) -> it's the RAW base64 AES-256 data
//     key, exactly as today. The sync encrypt()/decrypt() above take this raw key.
//   - wrapped:true (KMS_KEY_ID set) -> it's a base64 KMS *ciphertext blob*: the data
//     key encrypted under the customer KMS key. We never persist the plaintext data
//     key; we ask KMS to unwrap it on demand and hold it only in memory.
//
// IMPORTANT: with no KMS_KEY_ID the path is byte-identical to before - createStoredKey()
// returns genKey() and loadDataKey() returns stored.key untouched. KMS is purely additive.
//
// The @aws-sdk/client-kms import is deferred (require) so the dependency is only loaded
// when KMS is actually enabled - keeps the default path free of AWS SDK overhead.
// ---------------------------------------------------------------------------

export type StoredKey = { key: string; wrapped: boolean };

function kmsClient() {
  // Lazy require so the default (non-KMS) path never touches the AWS SDK.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { KMSClient } = require('@aws-sdk/client-kms');
  const region = process.env.AWS_REGION ?? 'us-east-1';
  return new KMSClient({ region });
}

/**
 * Mint a data key for a new meeting.
 *  - KMS_KEY_ID set  -> random 32-byte data key, KMS-encrypted under that key; we store
 *    only the wrapped ciphertext blob (wrapped:true).
 *  - otherwise       -> raw base64 data key via genKey() (wrapped:false) - unchanged.
 */
export async function createStoredKey(): Promise<StoredKey> {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) return { key: genKey(), wrapped: false };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EncryptCommand } = require('@aws-sdk/client-kms');
  const dataKey = randomBytes(32); // AES-256 data key, kept in memory only
  const out = await kmsClient().send(
    new EncryptCommand({ KeyId: keyId, Plaintext: dataKey }),
  );
  return {
    key: Buffer.from(out.CiphertextBlob as Uint8Array).toString('base64'),
    wrapped: true,
  };
}

/**
 * Resolve a StoredKey back to the RAW base64 data key that encrypt()/decrypt() expect.
 *  - wrapped:false -> stored.key as-is (the raw key) - unchanged default path.
 *  - wrapped:true  -> KMS Decrypt the ciphertext blob to recover the plaintext data key.
 */
export async function loadDataKey(stored: { key: string; wrapped?: boolean }): Promise<string> {
  if (!stored.wrapped) return stored.key;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DecryptCommand } = require('@aws-sdk/client-kms');
  const out = await kmsClient().send(
    new DecryptCommand({ CiphertextBlob: Buffer.from(stored.key, 'base64') }),
  );
  return Buffer.from(out.Plaintext as Uint8Array).toString('base64');
}
