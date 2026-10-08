import {providerFetch} from '../../execution/src/index.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../../contracts/src/index.js';
import { IntentCipher } from '../../storage/src/intent-cipher.js';
export interface AdminIdentity { tenantId: string; objectId: string }
interface Session { actor: AdminIdentity; csrf: string; expires: number }
interface Pending { state: string; verifier: string; nonce: string; expires: number }
export interface AdminAuthOptions {
  publicUrl: string;
  fixtureAuthenticate?: (token: string) => Promise<AdminIdentity>;
  entra?: { tenantId: string; clientId: string; clientSecret: string; keys?: JWTVerifyGetKey };
  fetch?: typeof fetch;
  now?: () => number;
}
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const token = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = () => new AppError('unauthenticated', 'Sign in to the operator console.');
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Server-side opaque sessions: ID/access tokens never enter browser storage. */
export class AdminSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly completedLogins = new Map<string, number>();
  private readonly loginCipher = new IntentCipher(randomBytes(32));
  private closed = false;
  private readonly base: URL;
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private readonly secure: boolean;
  private readonly cookieName: string;
  private readonly loginCookieName: string;
  readonly mode: 'fixture' | 'entra' | 'unavailable';
  constructor(private readonly options: AdminAuthOptions) {
    this.base = new URL(options.publicUrl); this.now = options.now ?? Date.now; this.fetcher = providerFetch('Entra',options.fetch ?? fetch);
    this.secure = this.base.protocol === 'https:';
    if (!this.secure && !(options.fixtureAuthenticate && ['127.0.0.1','localhost'].includes(this.base.hostname))) throw new Error('Admin authentication requires HTTPS outside loopback fixtures.');
    if (options.entra && (!guid.test(options.entra.tenantId) || !guid.test(options.entra.clientId) || !options.entra.clientSecret)) throw new Error('Valid Entra console registration is required.');
    this.mode = options.fixtureAuthenticate ? 'fixture' : options.entra ? 'entra' : 'unavailable';
    this.cookieName = this.secure ? '__Host-rarity-admin' : 'rarity-fixture-admin';
    this.loginCookieName = this.secure ? '__Host-rarity-login' : 'rarity-fixture-login';
  }
  private sweep() {
    for (const [key, item] of this.sessions) if (item.expires <= this.now()) this.sessions.delete(key);
    for (const [key, expires] of this.completedLogins) if (expires <= this.now()) this.completedLogins.delete(key);
  }
  private cookie(name: string, value: string, seconds: number) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${this.secure ? '; Secure' : ''}`; }
  private readCookie(request: Request, name: string) {
    const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
  }
  private issue(actor: AdminIdentity, expires = this.now() + 3_600_000) {
    if (this.closed) throw denied();
    this.sweep(); if (this.sessions.size >= 500) throw new AppError('throttled', 'Console session capacity is full.');
    const opaque = token(), session = { actor: { ...actor }, csrf: token(), expires: Math.min(expires, this.now() + 3_600_000) };
    if (session.expires <= this.now()) throw denied();
    this.sessions.set(hash(opaque), session);
    return { cookie: this.cookie(this.cookieName, opaque, Math.floor((session.expires - this.now()) / 1000)), session };
  }
  session(request: Request, mutation = false): Session {
    this.sweep(); const opaque = this.readCookie(request, this.cookieName);
    const session = opaque.length === 43 ? this.sessions.get(hash(opaque)) : undefined;
    if (!session) throw denied();
    if (mutation && (request.headers.get('origin') !== this.base.origin || !equal(request.headers.get('x-csrf-token') ?? '', session.csrf))) throw new AppError('forbidden', 'The console request origin or session token is invalid.');
    return structuredClone(session);
  }
  async fixtureLogin(request: Request, suppliedToken: string) {
    if (!this.options.fixtureAuthenticate || request.headers.get('origin') !== this.base.origin || suppliedToken.length > 16_384) throw denied();
    const actor = await this.options.fixtureAuthenticate(suppliedToken);
    return this.issue(actor);
  }
  beginLogin() {
    if (this.closed) throw denied();
    const config = this.options.entra; if (!config || this.mode !== 'entra') throw new AppError('dependency_unavailable', 'Entra console sign-in is not configured.');
    const state = token(), verifier = token(), nonce = token();
    // Abandoned unauthenticated requests allocate no global admission slots.
    const pending: Pending = { state, verifier, nonce, expires: this.now() + 600_000 };
    const sealed = this.loginCipher.seal(pending, `admin-login:${this.base.origin}`);
    const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: new URL('/admin/callback', this.base).href,
      response_mode: 'query', scope: 'openid profile', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { location: url.href, cookie: this.cookie(this.loginCookieName, sealed, 600) };
  }
  async callback(request: Request) {
    const config = this.options.entra; if (!config || this.closed) throw denied();
    const url = new URL(request.url), state = url.searchParams.get('state') ?? '', code = url.searchParams.get('code') ?? '';
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 8192) throw denied();
    try {
      const sealed = this.readCookie(request, this.loginCookieName);
      if (!sealed || sealed.length > 1024) throw denied();
      const pending = this.loginCipher.open(sealed, `admin-login:${this.base.origin}`) as Pending;
      if (!pending || ![pending.state, pending.verifier, pending.nonce].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)) || !equal(state, pending.state) || !Number.isSafeInteger(pending.expires) || pending.expires <= this.now() || pending.expires > this.now() + 600_000) throw denied();
      this.sweep(); if (this.completedLogins.has(hash(state))) throw denied();
      const response = await this.fetcher(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code,
          redirect_uri: new URL('/admin/callback', this.base).href, code_verifier: pending.verifier, scope: 'openid profile' }) });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 65_536) throw denied();
      const reader = response.body?.getReader(); if (!reader) throw denied();
      let bytes = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 65_536) { await reader.cancel(); throw denied(); } chunks.push(part.value); } } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id_token?: unknown };
      if (typeof data.id_token !== 'string' || data.id_token.length > 32_768) throw denied();
      const keys = config.keys ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`), { timeoutDuration: 5000 });
      const { payload } = await jwtVerify(data.id_token, keys, { algorithms: ['RS256'], issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`, audience: config.clientId,
        requiredClaims: ['exp','iat','nonce','tid','oid','sub'], clockTolerance: 0, currentDate: new Date(this.now()) });
      if (payload.tid !== config.tenantId || typeof payload.oid !== 'string' || !guid.test(payload.oid) || typeof payload.nonce !== 'string' || !equal(payload.nonce, pending.nonce)) throw denied();
      // Only verified identities occupy replay capacity. Recheck after awaits;
      // concurrent callbacks must never issue two sessions for one transaction.
      this.sweep();
      if (this.closed || pending.expires <= this.now() || this.completedLogins.has(hash(state))) throw denied();
      if (this.completedLogins.size >= 500) throw new AppError('throttled', 'Console session capacity is full.');
      const issued = this.issue({ tenantId: config.tenantId, objectId: payload.oid }, payload.exp! * 1000);
      this.completedLogins.set(hash(state), pending.expires);
      return { ...issued, clearLoginCookie: this.cookie(this.loginCookieName, '', 0) };
    } catch { throw denied(); }
  }
  logout(request: Request) {
    this.session(request, true); this.sessions.delete(hash(this.readCookie(request, this.cookieName)));
    return this.cookie(this.cookieName, '', 0);
  }
  close() { this.closed = true; this.sessions.clear(); this.completedLogins.clear(); }
}
