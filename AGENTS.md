# Project instructions

## Version every MCP update deployment

Every deployment containing MCP updates must use a new release version. Never deploy changed code, tool schemas, instructions, or behavior under an already deployed version.

- Before building the release, bump `SERVER_RELEASE` in `apps/server/src/publication.ts`. This is the version advertised by the MCP server and returned by `at_diagnostics`.
- Use a distinct deployment image tag and record the version, image, and changes in `docs/CURRENT-STATUS.md`.
- When a ChatGPT or Codex plugin package or listing is part of the release, also update its applicable manifest/package version and publish or refresh that metadata through its supported release process. Locate the actual source of the displayed version; do not assume the MCP server version automatically updates a plugin listing.
- After deployment, verify the running server advertises the intended new version through MCP initialization/discovery and `at_diagnostics`. Verify the client-visible plugin version where available; report client refresh or publication as pending if it has not been verified.
- Keep any release-version fields used by the distribution consistent. Do not mistake the MCP protocol version for the application release version.

A documentation-only edit to this file does not itself require deploying the MCP.
