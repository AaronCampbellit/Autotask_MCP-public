import { validAreaPermissions } from '../../policy/src/areas.js';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError, positiveId, validCompanyId, type Principal, type PrincipalStore } from '../../contracts/src/index.js';

export const DEFAULT_RESOURCE_MAX_AGE_MS = 5 * 60 * 1000;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const remoteKeys = new Map<string, JWTVerifyGetKey>();

export interface MappingValidationOptions {
  resourceMaxAgeMs?: number;
  now?: () => Date;
}

export interface EntraAuthConfig extends MappingValidationOptions {
  tenantId: string;
  audience: string;
  requiredScopes: string[];
  /** Server-side injection for testing or a trusted JWKS cache; never client input. */
  jwks?: JWTVerifyGetKey;
}

/** Validate the server-owned, operator-verified resource mapping, never token resource claims. */
export function validatePrincipalMapping(
  principal: Principal | undefined,
  tenantId: string,
  objectId: string,
  options: MappingValidationOptions = {},
): Principal {
  const maxAge = options.resourceMaxAgeMs ?? DEFAULT_RESOURCE_MAX_AGE_MS;
  const now = (options.now?.() ?? new Date()).getTime();
  if (!Number.isFinite(maxAge) || maxAge <= 0 || !Number.isFinite(now)) {
    throw new AppError('identity_validation_unavailable', 'Identity verification configuration is unavailable.');
  }
  if (!principal || principal.tenantId !== tenantId || principal.objectId !== objectId ||
    (principal.areaPermissions!==undefined&&!validAreaPermissions(principal.areaPermissions)) || principal.active !== true || !positiveId(principal.resourceId) ||
    !positiveId(principal.mappingVersion) || typeof principal.policyVersion !== 'string' ||
    principal.policyVersion.length === 0 || !Array.isArray(principal.capabilities) ||
    !Array.isArray(principal.companyIds) || !principal.companyIds.every(validCompanyId)) {
    throw new AppError('identity_mapping_invalid', 'An active, verified employee mapping is required. Contact an access administrator.');
  }
  const verifiedAt = typeof principal.resourceVerifiedAt === 'string' ? Date.parse(principal.resourceVerifiedAt) : NaN;
  if (!Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > maxAge) {
    throw new AppError('identity_validation_unavailable', 'Employee resource verification must be refreshed before continuing.', true);
  }
  return { ...principal, ...(principal.areaPermissions!==undefined?{areaPermissions:[...principal.areaPermissions]}:{}), capabilities: [...principal.capabilities], companyIds: [...principal.companyIds] };
}

export async function loadVerifiedPrincipal(
  tenantId: string,
  objectId: string,
  store: PrincipalStore,
  options: MappingValidationOptions = {},
): Promise<Principal> {
  let principal: Principal | undefined;
  try {
    principal = await store.get(tenantId, objectId);
  } catch {
    throw new AppError('identity_validation_unavailable', 'Employee identity validation is temporarily unavailable.', true);
  }
  return validatePrincipalMapping(principal, tenantId, objectId, options);
}

/** Verify an Entra v2 delegated access token and re-read local activity on every request. */
export async function authenticateToken(token: string, config: EntraAuthConfig, store: PrincipalStore): Promise<Principal> {
  if (!guid.test(config.tenantId) || !config.audience.trim() ||
    !Array.isArray(config.requiredScopes) || config.requiredScopes.length === 0 ||
    config.requiredScopes.some(scope => !scope || /\s/.test(scope))) {
    throw new AppError('identity_validation_unavailable', 'Authentication configuration is unavailable.');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 32_768) {
    throw new AppError('unauthenticated', 'A valid delegated access token is required.');
  }
  let keys = config.jwks ?? remoteKeys.get(config.tenantId);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1000,
    });
    remoteKeys.set(config.tenantId, keys);
  }
  let tenantId: string;
  let objectId: string;
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['RS256'],
      issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
      audience: config.audience,
      requiredClaims: ['exp', 'nbf', 'iat', 'tid', 'oid', 'scp'],
      currentDate: config.now?.(),
      clockTolerance: 0,
    });
    if (payload.tid !== config.tenantId || typeof payload.oid !== 'string' || !guid.test(payload.oid) ||
      typeof payload.scp !== 'string' || payload.idtyp === 'app') {
      throw new Error('Invalid delegated employee claims.');
    }
    const scopes = new Set(payload.scp.split(/\s+/).filter(Boolean));
    if (!config.requiredScopes.every(scope => scopes.has(scope))) {
      throw new Error('Required delegated scopes are missing.');
    }
    tenantId = payload.tid;
    objectId = payload.oid;
  } catch {
    // Do not expose claims, tokens, signing-key details or upstream transport errors.
    throw new AppError('unauthenticated', 'A valid delegated access token is required.');
  }
  return loadVerifiedPrincipal(tenantId, objectId, store, config);
}
