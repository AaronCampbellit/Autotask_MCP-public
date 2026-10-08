# Reviewed metadata mount

The image contains this empty configuration directory. No tenant metadata, identities, passwords or live qualifications are baked into the image.

Mount the reviewed snapshot and its evidence files here read-only. A snapshot at `/app/config/metadata/snapshot.json` uses `METADATA_SNAPSHOT_PATH=/app/config/metadata/snapshot.json`. Local source references in the snapshot resolve against `/app`, so evidence in this directory must use references beginning `config/metadata/`. Compile and hash the reviewed evidence using those exact relative paths before promotion; moving or modifying a source after compilation invalidates the evidence.

Leave `METADATA_SNAPSHOT_PATH` and `ENABLED_AUTOTASK_OPERATIONS` empty until the deployment owner has supplied and qualified the real tenant data. The 231-entity documentary inventory does not enable any live operation.

The same read-only mount can hold `/app/config/metadata/threshold.json` for `AUTOTASK_THRESHOLD_PATH` and its bounded, hash-verified source capture. Its evidence references also resolve against `/app`. All four explicit request-budget values and fresh truthful ThresholdInformation evidence are required before live requests can be admitted. A separately reviewed collector updates the capture; reading it does not refresh its observation time or prove tenant capacity.
