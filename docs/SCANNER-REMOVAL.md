# Scanner removal — deployed September 15, 2026

Deployment and targeted cleanup are complete in `0.1.0-contact-role.20260915.1`. Live scanner-free staging/readback/cleanup passed. No native business records were modified. The preparation evidence and original checklist below are historical; see [current deployment evidence](CURRENT-STATUS.md).

## Implemented scope

Upload staging and ticket attachment upload no longer require malware verdicts. Removed the scanner gateway/ClamAV client, gateway adapter, scanner-only tests, scanner Dockerfile/Compose override and scanner-only runbook. Runtime startup, preflight, environment templates and console/tool wording no longer require scanning. No scanner-only npm dependency existed; shared dependencies are unchanged.

Retained: authorization and current ticket scope, actor ownership, safe filenames, canonical base64, file-size limits, extension/MIME/content signatures, UTF-8 checks, encrypted storage/checksums, expiry and quotas, reviewed internal visibility, native readback, shared attachment byte budgets, durable idempotency and uncertain-outcome handling. File validation does not claim malware detection.

The optional internal `scannerVersion` property remains solely for backward compatibility with old stored ATF1 ciphertext. It is authenticated encryption metadata: removing or changing it would make existing files undecryptable. New artifacts never set it, and public summaries never emit `scanner_version` or scan claims. Existing unexpired, authorized ready artifacts require no re-upload. Expired or incomplete artifacts retain their existing lifecycle restrictions.

## Deferred deployment and cleanup

Do not execute this section until deployment is authorized.

1. Build the new release and record current service configuration privately. Preserve PostgreSQL, artifact data, keys and operation journals. Do not print expanded Compose configuration or secrets.
2. Update the runtime image setting. Use the existing main Compose, HTTPS override and collector override, **without** the deleted scanner override. Keep public TLS/Entra, collector and database configuration intact. Recreate the server and verify readiness.
3. Confirm server configuration no longer injects scanner credentials, scanner endpoint, scanner certificate mount or scanner-only `NODE_EXTRA_CA_CERTS`. Remove scanner-only variables from the private runtime environment and secret store. Do not remove the artifact encryption key, cursor secret, operation payload key, public TLS certificates or any shared CA settings.
4. Verify authenticated metadata and the existing staged-file lifecycle under the new release. Use fixtures for full writes unless a particular live upload is authorized. Confirm tool controls allow staging/upload if an operator previously disabled them only because scanning was unavailable; do not override unrelated control decisions.
5. After verification, remove only the identified obsolete services: `autotask-imac-test-clamav-1`, `autotask-imac-test-scanner-1`, and `autotask-imac-test-scanner-tls-1`. Remove the dedicated scanner-signatures volume and scanner-internal network only after confirming no remaining users.
6. Remove scanner-only images only when unreferenced. The Caddy image may be shared with the public HTTPS proxy: preserve shared images and services. Do not use global Docker prune or broad orphan deletion.
7. Identify scanner-only certificate/key paths from the old override/private configuration, then remove those files and scanner-token copies from retired runtime-env backups under the chosen retention policy. Preserve the public HTTPS and collector files. This local preparation has not deleted any live certificate or secret.
8. Record live verification, refresh client metadata, then commit and push the reviewed changes as requested. Neither commit nor push has been performed for this removal.

## Validation evidence

Focused suites passed before full validation: 43 artifact/attachment/preflight/live-system tests, then 27 artifact/attachment compatibility tests including historical ciphertext upload and replay. Final type-check and TypeScript build passed; the full suite passed all **624 tests**. The MCP output-contract suite separately passed all 14 tests, including actual tools/list descriptions. The generated tool catalog was refreshed. The local image `rarity-autotask-mcp:upload-validation-candidate-20260915` built successfully; an isolated, network-disabled image check confirmed artifact handling is present and scanner application/adapter files are absent. `git diff --check` passed. The running server remains healthy on `rarity-autotask-mcp:ticket-role-20260915`. No live upload, deployment, container removal, volume/image cleanup or private-secret modification was performed.
