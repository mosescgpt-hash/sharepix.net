/**
 * Offline booth codes (docs/booth-mode.md, "Offline kiosk"): the attendee's
 * contact details travel INSIDE their QR code, encrypted on the kiosk with
 * SharePix's public key. Nobody without the private key — the host, the
 * photographer, anyone who photographs the screen — can read them. The server
 * decrypts when it finds the code in an uploaded photo.
 *
 * Scheme (ECIES over WebCrypto, available in every browser and Node 18+):
 *   ephemeral ECDH P-256 → 32-byte shared secret
 *   HKDF-SHA-256(salt = ephemeral public key, info = 'sharepix-booth-v1') → AES-128-GCM key
 *   AES-GCM with a random 12-byte IV, additional data = `SPB1.<eventId>.<personId>`
 * so a code only decrypts for the event it was made for, and its person id
 * cannot be swapped.
 *
 * QR payload: `SPB1.<personId>.<base64url(ephemeralPub[65] | iv[12] | ciphertext+tag)>`
 * The event id is NOT in the payload (the upload says which event it is) —
 * that keeps the code small enough to scan easily off a screen.
 *
 * Shared, byte-identical, with amplify/functions/process-pro-photo/boothSeal.ts
 * (Amplify functions take no cross-bundle imports). No dependencies.
 */

export const BOOTH_OFFLINE_PREFIX = 'SPB1.';
const INFO = 'sharepix-booth-v1';

export interface BoothContact {
  email: string | null;
  phone: string | null;
  /** The attendee ticked the texting consent. Only meaningful with a phone. */
  smsConsent: boolean;
}

export const MAX_EMAIL_LENGTH = 254;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('This device cannot make secure codes.');
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** A device-made person id: 9 random bytes, 12 base64url characters. */
export function newPersonId(): string {
  return toBase64Url(randomBytes(9));
}

export function isPersonId(id: string): boolean {
  return /^[A-Za-z0-9_-]{12}$/.test(id);
}

/** Email lower-cased and checked, or null when blank. Throws on a bad one. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? '').trim().toLowerCase();
  if (!email) return null;
  if (!EMAIL.test(email) || email.length > MAX_EMAIL_LENGTH) throw new Error('Check the email address.');
  return email;
}

/**
 * A phone number as E.164, or null when blank. Ten digits are taken as US/
 * Canada (+1); anything else must start with + and a country code. Throws on
 * something that cannot be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  let e164: string;
  if (text.startsWith('+')) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  else throw new Error('Check the phone number — include the country code if it is not a US number.');
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw new Error('Check the phone number.');
  return e164;
}

/** Validated contact, or why not: at least one way to reach them. */
export function checkContact(input: {
  email?: string | null;
  phone?: string | null;
  smsConsent?: boolean | null;
  emailConsent?: boolean | null;
}): { ok: true; contact: BoothContact } | { ok: false; reason: string } {
  let email: string | null;
  let phone: string | null;
  try {
    email = normalizeEmail(input.email);
    phone = normalizePhone(input.phone);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (!email && !phone) return { ok: false, reason: 'Enter an email address or a cell number.' };
  if (email && input.emailConsent !== true) {
    return { ok: false, reason: 'Tick the box so we can email you your photos.' };
  }
  if (phone && input.smsConsent !== true) {
    return { ok: false, reason: 'Tick the texting box, or leave the cell number blank.' };
  }
  return { ok: true, contact: { email, phone, smsConsent: Boolean(phone && input.smsConsent) } };
}

/** Compact plaintext: three newline-separated fields. */
export function encodeContact(c: BoothContact): string {
  return `${c.email ?? ''}\n${c.phone ?? ''}\n${c.smsConsent ? '1' : '0'}`;
}

export function decodeContact(text: string): BoothContact | null {
  const parts = text.split('\n');
  if (parts.length !== 3) return null;
  const checked = checkContact({
    email: parts[0],
    phone: parts[1],
    smsConsent: parts[2] === '1',
    emailConsent: true,
  });
  if (!checked.ok) {
    // A phone without texting consent is still a valid email signup.
    if (parts[0] && parts[2] !== '1') {
      const emailOnly = checkContact({ email: parts[0], emailConsent: true });
      return emailOnly.ok ? emailOnly.contact : null;
    }
    return null;
  }
  return checked.contact;
}

function aad(eventId: string, personId: string): Uint8Array {
  return new TextEncoder().encode(`${BOOTH_OFFLINE_PREFIX}${eventId}.${personId}`);
}

async function aesKey(shared: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: new TextEncoder().encode(INFO) },
    base,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt contact details into a QR payload. Runs on the kiosk, offline. */
export async function sealContact(input: {
  contact: BoothContact;
  eventId: string;
  personId: string;
  publicKey: string; // base64url raw uncompressed P-256 point (65 bytes)
}): Promise<string> {
  const recipient = await subtle().importKey(
    'raw',
    fromBase64Url(input.publicKey) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const eph = (await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const shared = await subtle().deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
  const ephRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const key = await aesKey(shared, ephRaw);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(input.eventId, input.personId) as BufferSource },
      key,
      new TextEncoder().encode(encodeContact(input.contact)),
    ),
  );
  const blob = new Uint8Array(ephRaw.length + iv.length + ct.length);
  blob.set(ephRaw, 0);
  blob.set(iv, ephRaw.length);
  blob.set(ct, ephRaw.length + iv.length);
  return `${BOOTH_OFFLINE_PREFIX}${input.personId}.${toBase64Url(blob)}`;
}

/** The person id and sealed blob of an offline code, or null when it is not one. */
export function parseOfflinePayload(payload: string): { personId: string; blob: Uint8Array } | null {
  const text = payload.trim();
  if (!text.startsWith(BOOTH_OFFLINE_PREFIX)) return null;
  const [personId, blobText, ...rest] = text.slice(BOOTH_OFFLINE_PREFIX.length).split('.');
  if (rest.length || !personId || !blobText || !isPersonId(personId)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(blobText)) return null;
  const blob = fromBase64Url(blobText);
  if (blob.length < 65 + 12 + 16 + 3) return null;
  return { personId, blob };
}

/**
 * Decrypt an offline code. Server only: the private key is PKCS#8, base64
 * (standard or url-safe), from a secret. Returns null for anything that does
 * not decrypt for THIS event — a code from another event, a tampered code, or
 * not a booth code at all.
 */
export async function openContact(input: {
  payload: string;
  eventId: string;
  privateKeyPkcs8: string;
}): Promise<{ personId: string; contact: BoothContact } | null> {
  const parsed = parseOfflinePayload(input.payload);
  if (!parsed) return null;
  try {
    const priv = await subtle().importKey(
      'pkcs8',
      fromBase64Url(input.privateKeyPkcs8.replace(/\s+/g, '').replace(/=+$/, '')) as BufferSource,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const ephRaw = parsed.blob.slice(0, 65);
    const iv = parsed.blob.slice(65, 77);
    const ct = parsed.blob.slice(77);
    const eph = await subtle().importKey('raw', ephRaw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await subtle().deriveBits({ name: 'ECDH', public: eph }, priv, 256);
    const key = await aesKey(shared, ephRaw);
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(input.eventId, parsed.personId) as BufferSource },
      key,
      ct as BufferSource,
    );
    const contact = decodeContact(new TextDecoder().decode(plain));
    return contact ? { personId: parsed.personId, contact } : null;
  } catch {
    return null;
  }
}

/** What the host sees instead of the contact: j***@gmail.com, or ***-***-4567. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  return `***-***-${phone.replace(/\D/g, '').slice(-4)}`;
}

export function contactLabel(c: BoothContact): string {
  if (c.email) return maskEmail(c.email);
  if (c.phone) return maskPhone(c.phone);
  return 'Guest';
}
