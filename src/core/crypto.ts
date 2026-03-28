import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers-sumo') as typeof import('libsodium-wrappers');
import type { Logger } from './logger.js';

/**
 * Crypto vault for credential encryption using libsodium.
 * Derives an encryption key from the master password using Argon2id.
 */
export class CryptoVault {
  private key: Uint8Array | null = null;
  private log: Logger;
  private ready = false;

  constructor(logger: Logger) {
    this.log = logger;
  }

  async init(masterPassword: string): Promise<void> {
    await sodium.ready;

    if (!masterPassword) {
      this.log.warn('No master password set — encryption disabled. Set MASTER_PASSWORD for production use.');
      this.ready = false;
      return;
    }

    // Derive a fixed salt from a known string using generichash
    const saltInput = sodium.from_string('aura-vault-salt-v1');
    const salt = sodium.crypto_generichash(sodium.crypto_pwhash_SALTBYTES, saltInput);

    this.key = sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      masterPassword,
      salt,
      sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      sodium.crypto_pwhash_MEMLIMIT_MODERATE,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    this.ready = true;
    this.log.info('Crypto vault initialized (Argon2id + XSalsa20-Poly1305)');
  }

  encrypt(plaintext: string): string {
    if (!this.ready || !this.key) {
      throw new Error('Crypto vault not initialized — set MASTER_PASSWORD');
    }

    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const cipher = sodium.crypto_secretbox_easy(
      sodium.from_string(plaintext),
      nonce,
      this.key,
    );

    // Concatenate nonce + cipher and encode as base64
    const combined = new Uint8Array(nonce.length + cipher.length);
    combined.set(nonce);
    combined.set(cipher, nonce.length);
    return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL);
  }

  decrypt(cipherBase64: string): string {
    if (!this.ready || !this.key) {
      throw new Error('Crypto vault not initialized — set MASTER_PASSWORD');
    }

    const combined = sodium.from_base64(cipherBase64, sodium.base64_variants.ORIGINAL);
    const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = combined.slice(0, nonceLen);
    const cipher = combined.slice(nonceLen);

    const decrypted = sodium.crypto_secretbox_open_easy(cipher, nonce, this.key);
    if (!decrypted) {
      throw new Error('Decryption failed — wrong password or corrupted data');
    }

    return sodium.to_string(decrypted);
  }

  isReady(): boolean {
    return this.ready;
  }

  destroy(): void {
    if (this.key) {
      sodium.memzero(this.key);
      this.key = null;
    }
    this.ready = false;
    this.log.info('Crypto vault destroyed');
  }
}
