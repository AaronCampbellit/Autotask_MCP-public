import { AppError } from '../../contracts/src/index.js';
import type { SqlClient } from '../../storage/src/index.js';
import type { AttachmentByteBudget } from './contracts.js';

/** Durable tenant-wide five-minute allowance matching Autotask's attachment threshold. */
export class PostgresAttachmentByteBudget implements AttachmentByteBudget {
  constructor(private readonly sql: SqlClient) {}
  async reserve(input: { tenantId: string; bytes: number }): Promise<void> {
    if (typeof input.tenantId !== 'string' || !input.tenantId.trim() || !Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > 7_000_000) throw new AppError('invalid_input', 'The attachment byte reservation is invalid.');
    try { await this.sql.query('SELECT attachment_reserve_bytes($1,$2::bigint)', [input.tenantId, input.bytes]); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('ATTACHMENT_BYTE_QUOTA')) throw new AppError('throttled', 'The shared Autotask attachment byte budget is exhausted.', true);
      throw new AppError('dependency_unavailable', 'The shared attachment byte budget is unavailable.');
    }
  }
}
