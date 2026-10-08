import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { AppError, type Principal, type PrincipalStore, type QueryRequest } from '../packages/contracts/src/index.js';
import { authenticateToken, validatePrincipalMapping, type EntraAuthConfig } from '../packages/identity/src/index.js';
import { assertCapability, assertCompanyScope, projectRecord, reauthorize, validateQuery, validateRequestedFields } from '../packages/policy/src/index.js';

const tenantId = '11111111-1111-1111-1111-111111111111';
const objectId = '22222222-2222-2222-2222-222222222222';
const now = new Date('2026-09-10T12:00:00Z');
const seconds = Math.floor(now.getTime() / 1000);
const keys = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...await exportJWK(keys.publicKey), kid: 'local-test', alg: 'RS256', use: 'sig' };
const config: EntraAuthConfig = {
  tenantId,
  audience: 'api://rarity-autotask',
  requiredScopes: ['access_as_user'],
  resourceMaxAgeMs: 5 * 60 * 1000,
  now: () => now,
  jwks: createLocalJWKSet({ keys: [jwk] }),
};
function employee(overrides: Partial<Principal> = {}): Principal {
  return {
    tenantId, objectId, resourceId: 17, mappingVersion: 1, policyVersion: 'p1',
    capabilities: ['operational.read', 'tickets.write', 'time.self'], companyIds: [100],
    active: true, resourceVerifiedAt: new Date(now.getTime() - 30_000).toISOString(), ...overrides,
  };
}
function store(principal: Principal | undefined = employee()): PrincipalStore {
  return { get: async () => principal };
}
function code(expected: string) {
  return (error: unknown) => error instanceof AppError && error.code === expected;
}
async function token(overrides: JWTPayload = {}, signingKey = keys.privateKey): Promise<string> {
  return new SignJWT({
    tid: tenantId, oid: objectId, iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    aud: config.audience, scp: 'access_as_user', exp: seconds + 600, nbf: seconds - 60,
    iat: seconds - 60, ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'local-test' }).sign(signingKey);
}

test('authenticates delegated identity only through the current server-owned resource mapping', async () => {
  let reads = 0;
  const mapping = employee();
  const principalStore: PrincipalStore = { get: async (tid, oid) => {
    reads++;
    assert.equal(tid, tenantId);
    assert.equal(oid, objectId);
    return mapping;
  } };
  const bearer = await token({ resourceId: 999, capabilities: ['platform.manage'], companyIds: [999] });
  const principal = await authenticateToken(bearer, config, principalStore);
  assert.equal(principal.resourceId, 17);
  assert.deepEqual(principal.companyIds, [100]);
  assert.equal(principal.capabilities.includes('platform.manage'), false);
  principal.companyIds.push(777);
  assert.deepEqual(mapping.companyIds, [100]);
  mapping.active = false;
  await assert.rejects(authenticateToken(bearer, config, principalStore), code('identity_mapping_invalid'));
  assert.equal(reads, 2);
});

test('rejects forged signatures without consulting the mapping store', async () => {
  const attackerKey = await generateKeyPair('RS256');
  await assert.rejects(authenticateToken(await token({}, attackerKey.privateKey), config, {
    get: async () => { assert.fail('Invalid tokens must not reach the mapping store.'); },
  }), code('unauthenticated'));
});

test('rejects wrong audience, issuer, tenant, identity, token times and delegated scope claims', async () => {
  const negativeClaims: JWTPayload[] = [
    { aud: 'https://graph.microsoft.com' },
    { iss: 'https://attacker.invalid/v2.0' },
    { tid: '33333333-3333-3333-3333-333333333333' },
    { oid: 'alice@example.test' }, { oid: undefined },
    { exp: seconds }, { exp: undefined },
    { nbf: seconds + 1 }, { nbf: undefined },
    { iat: undefined },
    { scp: undefined, roles: ['access_as_user'] },
    { scp: 'access_as_user_extra' }, { scp: '' },
    { idtyp: 'app' },
  ];
  for (const claims of negativeClaims) {
    await assert.rejects(authenticateToken(await token(claims), config, store()), code('unauthenticated'), JSON.stringify(claims));
  }
  await assert.rejects(authenticateToken('not-a-jwt', config, store()), code('unauthenticated'));
});

test('rejects empty delegated scope configuration', async () => {
  await assert.rejects(authenticateToken(await token(), { ...config, requiredScopes: [] }, store()), code('identity_validation_unavailable'));
});

test('accepts a rotated signing key from the configured key resolver', async () => {
  const rotated = await generateKeyPair('RS256', { extractable: true });
  const rotatedJwk = { ...await exportJWK(rotated.publicKey), kid: 'local-test', alg: 'RS256', use: 'sig' };
  assert.equal((await authenticateToken(await token({}, rotated.privateKey), {
    ...config, jwks: createLocalJWKSet({ keys: [rotatedJwk] }),
  }, store())).resourceId, 17);
});

test('rejects missing, inactive, mismatched and malformed resource mappings', () => {
  const invalid: Array<Principal | undefined> = [
    undefined, employee({ active: false }), employee({ resourceId: 0 }), employee({ resourceId: -1 }),
    employee({ resourceId: 1.5 }), employee({ resourceId: Number.MAX_SAFE_INTEGER + 1 }),
    employee({ mappingVersion: 0 }), employee({ policyVersion: '' }),
    employee({ tenantId: 'another-tenant' }), employee({ objectId: 'another-employee' }),
    employee({ companyIds: [-1] }),
  ];
  for (const mapping of invalid) {
    assert.throws(() => validatePrincipalMapping(mapping, tenantId, objectId, config), code('identity_mapping_invalid'));
  }
});

test('rejects stale, missing, future and invalid resource verification timestamps', () => {
  for (const timestamp of ['', 'invalid', new Date(now.getTime() + 1).toISOString(), new Date(now.getTime() - 300_001).toISOString()]) {
    assert.throws(() => validatePrincipalMapping(employee({ resourceVerifiedAt: timestamp }), tenantId, objectId, config), code('identity_validation_unavailable'));
  }
});

test('mapping-store outages produce a sanitized fail-closed error', async () => {
  await assert.rejects(authenticateToken(await token(), config, { get: async () => {
    throw new Error('connection password=secret-canary');
  } }), error => code('identity_validation_unavailable')(error) && error instanceof Error && !error.message.includes('secret-canary'));
});

test('capability and direct company checks deny inactive employees and foreign or unresolved IDs', () => {
  assertCapability(employee(), 'operational.read');
  assertCompanyScope(employee(), 100);
  assert.throws(() => assertCapability(employee(), 'finance.read'), code('forbidden'));
  assert.throws(() => assertCapability(employee({ active: false }), 'operational.read'), code('forbidden'));
  for (const companyId of [999, undefined, null, '100', 0]) {
    assert.throws(() => assertCompanyScope(employee(), companyId), code('not_found_or_inaccessible'));
  }
});

test('projection removes financial, unknown and nested fields across all supported entities', () => {
  const actor = employee();
  assert.deepEqual(projectRecord('Tickets', { id: 10, title: 'Visible', companyID: 100, estimatedLaborCost: 999, secret: 'canary', userDefinedFields: [{ value: 'secret' }], description: { secret: 'canary' } }, actor), { id: 10, title: 'Visible', companyID: 100 });
  assert.deepEqual(projectRecord('TicketNotes', { id: 11, ticketID: 10, description: 'Visible note', hiddenCost: 999 }, actor), { id: 11, ticketID: 10, description: 'Visible note' });
  assert.deepEqual(projectRecord('TimeEntries', { id: 12, hoursWorked: 1, hourlyBillingRate: 200, internalBillingRate: 99 }, actor), { id: 12, hoursWorked: 1 });
  assert.deepEqual(projectRecord('Companies', { id: 100, companyName: 'Example', taxID: 'sensitive', billingAddressSecret: 'canary' }, actor), { id: 100, companyName: 'Example' });
  const finance = employee({ capabilities: ['operational.read', 'finance.read'] });
  assert.deepEqual(projectRecord('TimeEntries', { id: 12, hoursWorked: 1, hourlyBillingRate: 200, unknownFinancialField: 500 }, finance), { id: 12, hoursWorked: 1, hourlyBillingRate: 200 });
});

test('requested field projections cannot request unknown or protected fields', () => {
  assert.deepEqual(projectRecord('Tickets', { id: 10, title: 'Visible', description: 'Omitted' }, employee(), ['title']), { id: 10, title: 'Visible' });
  assert.throws(() => validateRequestedFields('Tickets', ['estimatedLaborCost'], employee()), code('forbidden'));
  assert.throws(() => validateRequestedFields('Tickets', ['*'], employee({ capabilities: ['finance.read'] })), code('forbidden'));
});

function query(overrides: Partial<QueryRequest> = {}): QueryRequest {
  return { entity: 'Tickets', pageSize: 25, filters: [{ field: 'companyID', op: 'eq', value: 100 }], ...overrides };
}

test('query validation blocks financial inference, unknown fields and foreign company filters', () => {
  validateQuery(query(), employee());
  assert.throws(() => validateQuery(query({ filters: [{ field: 'estimatedLaborCost', op: 'gte', value: 0 }] }), employee()), code('forbidden'));
  assert.throws(() => validateQuery(query({ filters: [{ field: 'privateCanary', op: 'eq', value: 'secret' }] }), employee()), code('forbidden'));
  assert.throws(() => validateQuery(query({ filters: [{ field: 'companyID', op: 'in', value: [100, 999] }] }), employee()), code('not_found_or_inaccessible'));
  assert.throws(() => validateQuery(query({ entity: 'Companies', filters: [{ field: 'id', op: 'eq', value: 999 }] }), employee()), code('not_found_or_inaccessible'));
  validateQuery(query({ filters: [{ field: 'estimatedLaborCost', op: 'gte', value: 0 }] }), employee({ capabilities: ['finance.read'] }));
});

test('query validation rejects unbounded and malformed filters before adapter dispatch', () => {
  const requests = [
    query({ pageSize: 501 }), query({ pageSize: 0 }), query({ parentId: -1 }),
    query({ filters: [{ field: 'id', op: 'eq', value: '1' }] }),
    query({ filters: [{ field: 'id', op: 'contains', value: 1 }] }),
    query({ filters: [{ field: 'title', op: 'eq', value: { $ne: null } }] }),
    query({ filters: [{ field: 'title', op: 'in', value: [] }] }),
    query({ filters: [{ field: 'title', op: 'in', value: Array.from({ length: 101 }, () => 'x') }] }),
    query({ filters: Array.from({ length: 13 }, () => ({ field: 'title', op: 'eq' as const, value: 'x' })) }),
  ];
  for (const request of requests) assert.throws(() => validateQuery(request, employee()), code('invalid_input'));
  validateQuery(query({ pageSize: 500 }), employee());
  assert.throws(() => validateQuery(query({ entity: 'Companies', pageSize: 101 }), employee()), code('invalid_input'));
  assert.throws(() => validateQuery({ ...query(), sort: 'estimatedLaborCost' } as QueryRequest, employee()), code('invalid_input'));
  assert.throws(() => validateQuery({ ...query(), filters: [{ field: 'title', op: 'eq', value: 'x', or: { estimatedLaborCost: 0 } }] } as unknown as QueryRequest, employee()), code('invalid_input'));
});

test('dispatch reauthorization rejects mapping changes, policy changes and revoked activity', async () => {
  const actor = employee();
  for (const current of [employee({ resourceId: 18 }), employee({ mappingVersion: 2 }), employee({ active: false })]) {
    await assert.rejects(reauthorize(actor, store(current), config), code('identity_mapping_invalid'));
  }
  await assert.rejects(reauthorize(actor, store(employee({ policyVersion: 'p2' })), config), code('forbidden'));
  await assert.rejects(reauthorize(actor, { get: async () => undefined }, config), code('identity_mapping_invalid'));
});

test('dispatch reauthorization rejects changed permissions and scope even when a store missed a version bump', async () => {
  await assert.rejects(reauthorize(employee(), store(employee({ capabilities: ['operational.read'] })), config), code('forbidden'));
  await assert.rejects(reauthorize(employee(), store(employee({ companyIds: [] })), config), code('forbidden'));
  await assert.rejects(reauthorize(employee(), store(employee({ companyIds: [100, 200] })), config), code('forbidden'));
  const current = await reauthorize(employee(), store(employee({ capabilities: ['time.self', 'tickets.write', 'operational.read'] })), config);
  assert.equal(current.resourceId, 17);
});

test('internal company zero is explicit scope, never a wildcard or another record ID', () => {
  const p = employee({companyIds:[0,186]});
  assert.doesNotThrow(() => validatePrincipalMapping(p, tenantId, objectId, {now:()=>now}));
  assert.doesNotThrow(() => assertCompanyScope(p,0));
  assert.throws(() => assertCompanyScope(employee(),0));
  for(const invalid of [-1,0.5,'0',Number.MAX_SAFE_INTEGER+1]) assert.throws(() => assertCompanyScope(p,invalid));
  assert.deepEqual(projectRecord('Companies',{id:0,companyName:'Internal'},p),{id:0,companyName:'Internal'});
  assert.throws(() => projectRecord('Tickets',{id:0},p));
  for(const [entity,field] of [['Companies','id'],['Tickets','companyID']] as const)
    assert.doesNotThrow(() => validateQuery({entity,filters:[{field,op:'in',value:[0,186]}],pageSize:10},p));
  assert.throws(() => validateQuery({entity:'Tickets',filters:[{field:'id',op:'eq',value:0}],pageSize:10},p));
});
