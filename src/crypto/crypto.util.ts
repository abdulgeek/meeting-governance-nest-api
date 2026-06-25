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
