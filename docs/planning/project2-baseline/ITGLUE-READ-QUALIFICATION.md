# Supplemental IT Glue read qualification

Reviewed September 20, 2026 against the [official API reference](https://api.itglue.com/developer/) and the retained September 15 endpoint inventory.

The implementation uses organization-nested expiration listing, configuration/status/contact reference dictionaries, and `include=related_items` on supported native parents. It does not invent a GET related-items endpoint. Reference output excludes customer counts; expiration output excludes linked resource names, descriptions and URLs. Related output contains only identifiers after fetching each supported target and checking its current organization; password targets are never fetched. Parent scope is checked again after traversal.

The documentation establishes the include mechanism but does not establish exhaustive relationship pagination or all returned linkage variants. Consequently related results always disclose incomplete coverage, cap traversal, and fail closed on missing or malformed linkage. Unknown destination families are omitted. These are fixture-qualified contracts; actual tenant response shapes and credentials remain deployment qualification work.

Tests cover cross-organization rows and targets, moved parents, secret-bearing bodies, absent pagination metadata, unreviewed dictionaries, and password target suppression. No live business writes or provider credentials were used.
