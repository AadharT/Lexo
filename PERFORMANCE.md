# Local performance work

The v0.5.0 search path ran synchronous SQLite queries on Electron's main thread. It ranked and generated excerpts for every matching section before selecting 100 documents. Background progress repeatedly refreshed the entire workspace, including synchronous filesystem stats for every managed document. React then repeatedly joined documents to cases and custom values using nested array scans.

## Changes

- A dedicated read-only search worker keeps SQL off Electron's main thread and independent of PDF/DOCX extraction. A newer request terminates an obsolete active query. A five-second timeout stops runaway queries and permits a clean retry. Worker shutdown resolves pending requests and closes both background services before backup, restore or workspace switching.
- One FTS entry per document supports ranking and exact result counts without ranking duplicate page/paragraph hits. SQLite selects a stable page before retrieving excerpts. Indexed document keys locate only the selected documents' sections; a separate section mapping makes replacement/deletion avoid full FTS scans.
- Global document results combine cases and legacy sources in the database, with exact totals and 25/50/100 rows per page. Changing query, source, filters or page size resets to page one. Case lists and individual case document lists render at most 25 rows.
- Indexing sends throttled, cached status snapshots. Data revisions change only when searchable records change. Renderer polling updates those snapshots rather than reloading the workspace. Unchanged document stats/text cache signatures avoid repeated text reads, hashes, manifest writes and metadata writes. Explicit rescan still verifies originals; a modified generated copy is rebuilt.
- UI workspace reads skip original-document filesystem stats. Sizes, modified dates and availability come from the indexer's cached observations; opening an original still checks its actual path. Settings-only operations read settings instead of rebuilding workspace state. Maps group custom values and documents by case, and memoized case search/statistics avoid nested joins on every keystroke.
- Existing derived indexes upgrade from their stored sections. Main case data, original documents, text copies and backup format remain compatible. No main-database schema migration is introduced.

## Verification

Local synthetic benchmark: 5,000 documents / 45,000 sections on this machine. The original broad-query path took about 450 ms for `common` and 667 ms for `common guarantee`. The revised path returned a 25-row page with exact 5,000-document totals in about 79 ms and 112 ms respectively. Empty browsing and metadata/rare-term searches took roughly 2–5 ms. These are local measurements, not a guarantee for every workspace or disk.

An actual Electron fixture with 30 cases and 111 managed/legacy documents verified pagination, exact totals, page-size changes, filter resets, rapid typing, source excerpts and per-case document pages. It observed zero full-workspace reloads during indexing/status polling. Concurrent search and main-event-loop checks completed in about 16–23 ms on that smaller fixture. A deliberately stuck worker verified cancellation, timeout and recovery without blocking the main event loop.

Regression coverage includes duplicate-free results beyond the former 100-result cap, Unicode search, cross-page matches, source/date/case filters, paused-source behavior, client-name search, validation, old derived-index upgrades, no filesystem access on UI state reads, no idle cache rehashing and unchanged indexing revisions. Existing durability, backup/restore, AI handoff and document extraction tests also run.

Limits: initial extraction still depends on document sizes, page counts and disk speed. The app still loads the case metadata catalogue when opening a workspace; its list rendering and joins are bounded/linear, but a million-case workspace has not been load-tested. Import, encrypted backup and restore retain their existing durability paths and have not been rewritten as part of this change. No real-firm workspace was used for testing, no executable was packaged, and release executables are produced only by GitHub Actions.
