import type { DataRecord } from '../../contracts/src/index.js';

/** Only the observed native status-change grammar is exposed. Never return raw history detail. */
export function classifyHistoryStatus(row: DataRecord): DataRecord {
  if (row.action !== 'Status Changed') return row;
  const match = typeof row.detail === 'string'
    ? /^Status changed from ([^\r\n]{1,100})\r?\nTime in status:[ \t]*(?:\d+[dhms][ \t]*)+to ([^\r\n]{1,100})$/.exec(row.detail)
    : null;
  return { ...row, status_transition_valid: Boolean(match),
    ...(match ? { from_status: match[1]!.trim(), to_status: match[2]!.trim() } : {}) };
}
