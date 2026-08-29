# Ocean Intelligence MCP 2.0

## Identity and isolation

- The Codex Runtime injects a 60-second HMAC tenant token into every Ocean MCP tool call.
- The token binds `sub` to the authenticated product user and `tid` to the Codex task.
- Identity fields are absent from public tool schemas; model-supplied `owner_id` values are ignored.
- Session, memory, job, snapshot, export and audit operations derive tenant ownership only from the verified token.

## Data access

- `ocean_data_page`, `ocean_data_search` and `ocean_source_data_page` create expiring PostgreSQL-backed snapshots; SQLite remains a local/test fallback.
- Continue paging with `next_cursor_token`; cursors are HMAC signed and bind owner, region, dataset, snapshot, offset and expiry.
- Every page returns dataset/product identity, units, data class, processing level, requested/effective bounds, valid/fetch time, version, latency placeholder, QC, missing/masked counts and complete/sample flags.
- `ocean_data_changes` returns inserts, updates and deletion tombstones relative to a prior snapshot, timestamp or revision.

## Jobs, batch and export

- Long work uses `ocean_job_submit`, `ocean_job_status`, `ocean_job_result_page` and `ocean_job_cancel`.
- `ocean_batch_points_submit` accepts up to 500 coordinates per job for marine-area, context, bathymetry, Argo, knowledge, wave and wind enrichment.
- `ocean_export_submit` creates CSV, GeoJSON, NDJSON, Parquet or NetCDF artifacts; `ocean_export_result` reads bounded chunks.
- Sessions, snapshots, jobs, cancellation state and audit rows persist in PostgreSQL across application restarts.

## Transport and governance

- Streamable HTTP supports strict media/protocol headers, JSON-RPC batch, cancellation notifications, SSE, subscriptions and restart-safe sessions.
- Per-tenant/tool rate and concurrency limits, execution timeout, response byte limit and external-source circuit breakers are enabled by environment variables.
- Every tool publishes an output schema and MCP safety annotations.
- Audit rows include tenant, Codex task, tool, redacted argument hash/summary, duration, count, error, write flag, source and data version.

## Deployment

- `deploy/lock-images.sh` resolves mutable base tags to immutable image digests.
- `deploy/deploy.sh` preserves a rollback tag, builds with cache, records an image digest, emits SBOM/vulnerability output when supported, waits for health and rolls back on failure.
- `deploy/Dockerfile.runtime-overlay` provides a network-independent emergency code rollout; the normal release path remains the complete root `Dockerfile` build.
