import { randomBytes } from 'node:crypto';

/** A fresh guest link key: 16 random bytes, base64url, 22 characters. */
export function newLinkKey(): string {
  return randomBytes(16).toString('base64url');
}
