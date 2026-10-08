# Implemented console screenshots

These PNGs show the actual console from the repository's local fixture server at a 1440 × 980 viewport. All records are fictitious; no live Autotask, Datto, Entra, IT Glue, or customer connection was used.

| File | Screen |
| --- | --- |
| `fixture-overview.png` | Workspace readiness, sample employee count, and connection boundaries. |
| `fixture-operation-controls.png` | Separate read/write operation switches and pause controls. |

To reproduce:

1. Run `npm ci`, then `npm run demo` from the repository root.
2. Open `http://127.0.0.1:3030/admin` in a fresh browser profile.
3. Sign in with a generated fixture token from the ignored `work/demo-credentials.json` file. Never include that token in a screenshot or commit.
4. Capture Overview and Operation controls at 1440 × 980. The token input is removed after sign-in.

Fixture directory onboarding is intentionally unconfigured; the People page can show unavailable Entra, resource, and company names. The screenshots do not certify live integration or write acceptance. Generated concepts and downloaded reference art are not used here.
