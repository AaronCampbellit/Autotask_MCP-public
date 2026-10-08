# Private ChatGPT connection

Status: the private tunnel is **running, healthy and ready** as of September 15, 2026. ChatGPT app creation, Entra sign-in and end-to-end tool validation are still pending. The existing Codex connection and MCP deployment remain unchanged. This connection uses OpenAI Secure MCP Tunnel to reach the LAN-only server through outbound HTTPS. A user's LAN/VPN connection alone does not route ChatGPT's cloud MCP requests to the iMac.

## Prepared on this iMac

- Official `openai/tunnel-client` v0.0.14, Darwin amd64, installed at `~/.local/bin/tunnel-client`. The downloaded archive was checked against the release's SHA256SUMS.txt. For subsequent installations, resolve the [latest official release](https://github.com/openai/tunnel-client/releases/latest) instead of copying a stale release URL.
- Private upstream target: `https://autotask-mcp.raritysolutions.com/mcp`.
- Operator helper: `python3 scripts/chatgpt-tunnel.py`.
- `check` verified HTTPS readiness, the expected Entra protected-resource metadata, and HTTP 401 for an unauthenticated MCP POST.
- No public listener, port forwarding, anonymous MCP mode or shared upstream bearer token was added. The managed tunnel daemon was started after the user supplied the tunnel ID/runtime key and explicitly authorized activation despite unverified pricing.

## OpenAI setup

1. Open [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels). Create the Rarity Autotask tunnel and associate it with the target ChatGPT workspace and owning Platform organization. Creation requires Tunnels Read + Manage. Selecting or running it requires Read + Use.
2. Record the returned `tunnel_id`. It is an identifier, not the runtime key.
3. Create a runtime key at [Platform API keys](https://platform.openai.com/settings/organization/api-keys) for a principal with Tunnels Read + Use. Do not use an admin key for the daemon.
4. In your own iMac terminal, from this repository, run:

   ```sh
   python3 scripts/chatgpt-tunnel.py save-key
   ```

   Paste the runtime key into the hidden prompt. It is stored outside Git at `~/.config/rarity-autotask-chatgpt/runtime-key` with owner-only permissions; it is not printed or passed on the process command line.
5. Connect using the actual ID:

   ```sh
   python3 scripts/chatgpt-tunnel.py connect tunnel_YOUR_ACTUAL_ID
   python3 scripts/chatgpt-tunnel.py status
   ```

   The helper uses the official client's managed-runtime supervisor. Check `process_running`, `healthy` and `ready`; a launched process alone does not establish a working connection. Leave its operator UI on loopback. Automatic recovery across machine restarts must be verified after connection; do not assume it from installation alone.
6. Enable developer mode in the target ChatGPT workspace, create a developer-mode app, and choose **Tunnel** for Connection. Select this tunnel. If it is missing, check workspace association and Tunnels Read + Use permission.

## Entra client authentication

The tunnel carries MCP requests and OAuth discovery; it does not replace per-user Entra authentication. Retain the API registration and existing Aaron-only server mapping.

Prepare a separate confidential Web client registration named `Rarity Autotask MCP ChatGPT` in tenant `581437a9-8e26-4857-bc56-1d5a04e7f752`. Use the existing `Rarity Autotask MCP API` registration (`4119f30b-8783-4883-ac03-cf120f23f8a8`) and its delegated scope `https://autotask-mcp.raritysolutions.com/mcp/mcp.access`. The API, Console and working Codex client do not need replacement.

Select OAuth with predefined/static client credentials in ChatGPT. Copy the **exact redirect URI shown by that ChatGPT connection** into the Entra Web redirect URI list. Do not guess it: current ChatGPT can use either a callback-ID-specific URI or a stable URI depending on authorization-server metadata and connection history. Enter the client ID and client-secret value directly into ChatGPT's credential fields, not the conversation or repository. Grant the required delegated consent under the existing organizational policy.

This registration and actual token exchange are still pending. Validate Entra discovery, PKCE, resource/audience, delegated scope, refresh and revocation with the real ChatGPT flow. If discovery or sign-in fails, inspect the failure; do not weaken token validation, forge issuer-support metadata or reuse the Console secret to bypass it.

## Acceptance checks

- Runtime status: running, healthy and ready.
- ChatGPT sign-in completes as Aaron; `at_whoami` reports the existing member.
- `at_discover` lists the allowed operations; it does not grant new permissions.
- Read-only prompt: “Use Rarity Autotask to find my open CRM to-dos.”
- Check refresh/reconnect and preservation of the existing company scope.
- Live business writes remain user-tested; no test record is created by this setup helper.

Stop the local tunnel with `python3 scripts/chatgpt-tunnel.py stop`. This does not delete the remote tunnel or stop the MCP/Codex deployment.

Sources checked September 15, 2026: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode), [OAuth and exact callback selection](https://developers.openai.com/plugins/build/auth), and the installed client's `help quickstart`, `help oauth`, and `runtimes connect --help`.

## Activation record

Tunnel `tunnel_6aa970996e948191946f3cf1e8dff500` is attached to the managed local alias `rarity-autotask-chatgpt`. Fresh runtime status reported process_running=true, healthy=true, ready=true and no remote lookup error. The remote tunnel includes a ChatGPT workspace association. Protected-resource and Entra metadata discovery succeeded. The runtime key is referenced from the private local file; no key or bearer token is recorded here. ChatGPT-side OAuth and tool calls have not yet been tested.
