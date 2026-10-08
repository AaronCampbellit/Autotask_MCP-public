# Operator console authentication

The production console uses Entra's authorization-code flow with PKCE and an
opaque, server-side operator session. ID tokens and access tokens do not enter
browser storage. Session cookies are HttpOnly, Secure, and SameSite=Lax; writes
also require the configured origin and the session's CSRF token.

Starting sign-in stores the state, PKCE verifier, nonce, and ten-minute expiry in
an encrypted HttpOnly transaction cookie. The existing AES-GCM intent cipher
authenticates the payload and binds it to the console origin and login purpose.
Its key is generated per process, so a restart invalidates pending transactions.
Abandoned or invalid unauthenticated login requests allocate no shared pending
slots and cannot evict another browser's transaction.

The callback validates the cookie/state binding, PKCE, Entra signature, issuer,
audience, tenant, identity, nonce, and expiry before issuing a session. A bounded
replay ledger records only successfully authenticated transactions, until their
original ten-minute expiry. Replay and expiry are checked again after asynchronous
provider verification, so concurrent callbacks issue at most one session. Closing
the authentication service permanently invalidates its transactions and sessions.

Failed provider exchanges do not occupy that replay ledger. A still-valid sealed
transaction can retry an exchange; Entra must enforce one-use authorization codes,
as required by [OAuth 2.0 section 4.1.2](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2).
This differs from consuming the transaction on the first failed callback. A code
and a valid, matching nonce/PKCE transaction remain necessary for authentication.
The replay and session limits each admit at most 500 authenticated entries; a
burst of verified sign-ins can still reach these deliberate capacity bounds.

The loopback fixture login is separate from Entra. It uses an explicitly supplied
fixture authenticator and retains origin, session, and CSRF checks. The fixture
mode does not qualify a production Entra deployment.

Focused regression coverage lives in
[`tests/admin-session.test.ts`](../tests/admin-session.test.ts), including abandoned
login floods, invalid callback floods, cookie tampering, cross-browser binding,
concurrent replay, expiry across provider awaits, and shutdown invalidation.
