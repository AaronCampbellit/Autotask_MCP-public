import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../../contracts/src/index.js';

export const MAX_INTENT_BYTES = 128 * 1024;
export const MAX_ENCRYPTED_INTENT_LENGTH = 2 + 3 + 16 + Math.ceil(MAX_INTENT_BYTES * 4 / 3) + 22;

function invalidIntent(): AppError {
  return new AppError('invalid_input', 'The workflow intent cannot be encrypted.');
}

function associatedData(binding: string): Buffer {
  if (typeof binding !== 'string' || !binding || Buffer.byteLength(binding, 'utf8') > 2048) throw invalidIntent();
  return Buffer.from(`autotask-mcp:intent:v1\0${binding}`, 'utf8');
}

/** Payload text is encrypted at rest; caller supplies the complete identity/intent binding and enforces expiry. */
export class IntentCipher {
  readonly #key: Buffer;

  constructor(secret: Buffer) {
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
      throw new AppError('dependency_unavailable', 'Workflow intent encryption requires a configured 32-byte key.');
    }
    this.#key = Buffer.from(secret);
  }

  seal(value: unknown, binding: string): string {
    try {
      const aad = associatedData(binding);
      const serialized = JSON.stringify(value);
      if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_INTENT_BYTES) throw invalidIntent();
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
      return ['v1', nonce.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    } catch {
      throw invalidIntent();
    }
  }

  open(ciphertext: string, binding: string): unknown {
    try {
      const aad = associatedData(binding);
      if (typeof ciphertext !== 'string' || ciphertext.length > MAX_ENCRYPTED_INTENT_LENGTH) throw new Error();
      const parts = ciphertext.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
      const encoded = parts.slice(1);
      if (!encoded.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      const decoded = encoded.map((part) => Buffer.from(part, 'base64url'));
      if (!decoded.every((part, index) => part.toString('base64url') === encoded[index])) throw new Error();
      const [nonce, body, tag] = decoded as [Buffer, Buffer, Buffer];
      if (nonce.length !== 12 || tag.length !== 16 || body.length < 1 || body.length > MAX_INTENT_BYTES) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.#key, nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8')) as unknown;
    } catch {
      throw new AppError('conflict', 'The stored workflow intent cannot be authenticated. No dispatch is authorized.');
    }
  }
}
