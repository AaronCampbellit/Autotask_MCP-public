import {contactIsActive} from './contact-status.js';
import { z } from 'zod';
import type { Principal } from '../../contracts/src/index.js';
import { companyReferenceSchema, parseDomainInput, resolveScopedReference } from '../../technician/src/index.js';
import type { ContactReference } from '../../technician/src/contracts.js';
import type { OperationalMetadata } from './metadata.js';
import { canonicalCompanyName } from '../../workflows/src/company-aliases.js';

const id = z.number().int().nonnegative().safe();
const text = z.string().trim().min(1).max(250);
export const contactReferenceInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('id'), id: z.number().int().positive().safe() }).strict(),
  z.object({ kind: z.literal('name'), name: text }).strict(),
  z.object({ kind: z.literal('email'), email: z.string().email().max(254) }).strict(),
]);
export const contactSearchSchema = z.object({
  company: z.union([id, text]),
  text: text.optional(),
}).strict();
export const contactGetSchema = z.object({ company: z.union([id, text]), contact: contactReferenceInputSchema }).strict();

/** Read-only contact directory facade used by operational tools. Every lookup
 * is bound to an authorized company and includes the documented parent-company
 * exception for ticket contacts. */
export class ContactLookup {
  constructor(private readonly metadata: OperationalMetadata) {}
  private async company(p: Principal, value: number | string): Promise<number> {
    if (typeof value === 'number') return value;
    const catalog = await this.metadata.resolveCatalog(p, 'company', {});
    return resolveScopedReference('company', { kind: 'name', name: canonicalCompanyName(value) }, catalog.items, catalog.version, p).id;
  }
  async search(p: Principal, input: unknown) {
    const args = parseDomainInput(contactSearchSchema, input);
    const companyId = await this.company(p, args.company);
    const rows = await this.metadata.searchContacts(p, companyId, args.text);
    return {
      status: 'succeeded', company_id: companyId, returned: rows.length,
      contacts: rows.map(row => ({ id: row.id, company_id: row.companyID, first_name: row.firstName, last_name: row.lastName, email: row.emailAddress, phone: row.phone, mobile_phone: row.mobilePhone, active: contactIsActive(row.isActive) })),
      provenance: { source: 'Autotask', complete: true },
    };
  }
  async get(p: Principal, input: unknown) {
    const args = parseDomainInput(contactGetSchema, input);
    const companyId = await this.company(p, args.company);
    const contact = await this.metadata.resolveContact(p, companyId, args.contact as ContactReference);
    return { status: 'succeeded', company_id: companyId, contact, provenance: { source: 'Autotask', complete: true } };
  }
}
