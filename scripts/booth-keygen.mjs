#!/usr/bin/env node
/**
 * Make the offline booth key pair (docs/booth-mode.md, "Offline kiosk keys").
 *
 *   node scripts/booth-keygen.mjs [out-dir]
 *
 * Prints the PUBLIC key (safe to share; goes in NEXT_PUBLIC_BOOTH_PUBLIC_KEY)
 * and writes the PRIVATE key to <out-dir>/booth-private-key.txt with mode
 * 0600 — it is not printed, so it never lands in terminal scrollback. Put it
 * in the BOOTH_PRIVATE_KEY Amplify environment variable, then delete the file.
 */
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const subtle = webcrypto.subtle;
const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const pub = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const priv = Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64url');

const out = resolve(process.argv[2] ?? '.', 'booth-private-key.txt');
writeFileSync(out, `${priv}\n`, { mode: 0o600, flag: 'wx' });

console.log('NEXT_PUBLIC_BOOTH_PUBLIC_KEY=' + pub);
console.log(`Private key written to ${join(out)} (mode 600). Set it as BOOTH_PRIVATE_KEY, then delete the file.`);
