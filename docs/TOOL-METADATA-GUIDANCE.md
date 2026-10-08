# Tool guidance cleanup — September 17, 2026

Deployment update: included in `0.1.0-attachments-access.20260917.1` on September 17, 2026. See [current release verification](CURRENT-STATUS.md). Earlier candidate/test statements below describe development checkpoints; live business and client-specific checks remain as noted.

A user screenshot showed ChatGPT flagging opportunity_note_create tool documentation as a suspicious instruction, citing status, authoring, verification and presentation directives. The local runtime appended broad guidance to all tools, including ticket presentation and status guidance on an opportunity note. Shared guidance also contained wording about not needing an approval round trip. This is a plausible contributor; the screenshot does not establish the exact internal classification rule or the complete deployed metadata.

The local change gives opportunity_note_create an operation-specific description of inputs, effects, limitations, retry safety and verification. Tool authoring reminders are shorter, status reminders appear only on relevant status-changing operations, and ticket presentation reminders are restricted to ticket tools. Shared drafting, progress/status and ticket financial-privacy rules remain in server instructions. Wording about approval requirements was removed. Write annotations, authorization, schemas and native write behavior are unchanged by this cleanup.

OpenAI recommends describing tool purpose, parameters and constraints and validating metadata changes with representative prompts: https://developers.openai.com/plugins/guides/optimize-metadata

Validation: 52 focused metadata/publication, extended-runtime and sales tests passed. The opportunity note remains annotated as a write. No deployment or live ChatGPT classifier verification was performed. A newly versioned deployment, connector metadata refresh and live retest are still needed; normal approval prompts may remain.
