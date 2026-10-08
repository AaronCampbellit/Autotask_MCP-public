# Chat images and attachment staging

Deployment update: included in `0.1.0-attachments-access.20260917.1` on September 17, 2026. See [current release verification](CURRENT-STATUS.md). Earlier candidate/test statements below describe development checkpoints; live business and client-specific checks remain as noted.

Deployed implementation; live ChatGPT paste/drop behavior remains to be verified with refreshed connector metadata.

Both `at_file_stage` and `opportunity_file_stage` accept a top-level `file` object and advertise `_meta["openai/fileParams"]: ["file"]`. The object requires `download_url` and `file_id`; `mime_type` and `file_name` are declared but optional, following the OpenAI file-input contract: https://developers.openai.com/plugins/reference#define-file-inputs . Existing base64 callers remain supported. Supply exactly one source.

The 64 KiB MCP request limit is unchanged. Base64 increases size by about one third, so even a roughly 48 KB image may exceed that limit once JSON and tool metadata are included. Native references keep the tool request small and fetch bytes separately, up to the existing configured attachment limit (6 MB by default). Increasing the global MCP limit is unnecessary.

Downloads run only after current identity, write access and parent scope checks. Only HTTPS oaiusercontent.com subdomains are accepted; redirects, URL credentials and nonstandard ports are rejected. No application credentials are forwarded. Signed URLs are not persisted or included in dependency error messages. The existing deadline, streaming byte cap, type/signature/extension validation, encrypted artifact storage, quotas and native upload verification remain in effect. An unsupported host or expired link returns an actionable error; it does not fall back to arbitrary URL fetching.

The console's My files & exports page accepts clipboard PNG/JPEG images in a labeled paste box, previews the selected image and reports its size. Choosing a file replaces the pasted selection and vice versa. Staging supports tickets and opportunities and does not itself publish an attachment. Use the returned staged artifact with the existing attachment upload action.

ChatGPT must supply a downloadable file reference. Visual access to a pasted image alone does not guarantee transferable original bytes. Retest pasted screenshots, dropped files, multiple separate images, expired references and both parent types with the refreshed connector. Other hosts require evidence and an explicitly reviewed allowlist change. The deployed server metadata does not by itself prove client file handoff.

## Validation

TypeScript and console JavaScript syntax checks passed. 63 targeted tests passed across artifact storage, attachment uploads, opportunity attachments, schema publication, native file inputs and the extended MCP/console system. The wire test transfers a 100 KB image through a small MCP request and verifies the stored bytes; unauthorized parents do not trigger downloads. A local browser test pasted a generated PNG, displayed its preview, and successfully staged it against a fictitious ticket. Live ChatGPT and Autotask were not used for these tests.
