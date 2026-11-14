# Search existing directories

In Settings → Search directories, enter an optional name and choose a folder outside the Lexo workspace. Lexo registers the directory and scans PDF and DOCX files in its subfolders. No cases or case-document records are created, and originals are never copied, renamed or modified by the indexer. Opening an original uses its existing location and default application; edits made there will be picked up by later scans.

Documents searches both case files and registered directories. The Source column shows the archive name and relative path. The source filter selects all sources, case documents, legacy directories or one registered directory. Bank, branch and document-type filters select case documents only: no case metadata is inferred for legacy files. Date filters use the legacy original's modification time. Results include matching text and source locations; Open original and Text open the source and its current generated copy respectively. Search pages through all matching indexed documents, with exact totals and selectable page sizes of 25, 50 or 100.

## Local files and refresh

- Directory registrations live in the existing workspace database settings, independently of case records.
- Derived copies live at `.lexo/legacy-text/<source-id>/<document-id>.txt`, beside freshness manifests and a Lexo ownership marker. Originals retain their existing directory structure. Document IDs derive from source ID and relative path; moving or renaming a file creates a new search identity and leaves the old record marked missing.
- The shared, rebuildable `.lexo-search.sqlite` index supports full-text search across both sources. It remains separate from the main case database.
- Source inventories are refreshed on startup, on focus (coalesced within a 30-second inventory window) and roughly every 30 seconds while idle. Rescan bypasses this window. Extraction runs in the background. Unchanged originals reuse their copies; Rescan also verifies source hashes. Save-in-progress files are deferred. Refresh text rebuilds the whole derived index.
- Pause stops indexing and suspends content search for that source. Filename/path metadata remains browsable. Resume picks up changes.
- Disconnected directories retain their records and previous copies. Their stale content is excluded from full-text search. A complete scan marks individual absent originals missing; failed or partial scans do not treat an unreadable folder as proof that its contents were deleted. Reconnect and Rescan to recover.
- Remove deletes only the verified generated cache and that source's search entries and registration. It never deletes original files. Unexpected files in the cache block cleanup and are preserved.

## Backups and limits

Workspace backups retain source registrations. They do **not** include external originals or their rebuildable legacy text cache. Back up those original directories separately. After restore or workspace relocation, Lexo rebuilds derived text from sources that are still accessible.

Scanned PDFs need OCR, which is not implemented. Partial PDF extraction is labelled with gaps. Old `.doc` files and other formats are skipped. Hidden directories, Word lock files and directory links are skipped; overlapping sources and workspace overlap are rejected. Limits are 50 sources, 100,000 files and 128 folder levels per source, plus the existing extraction limits (100 MB per document, 2,000 PDF pages, bounded extracted text). Read failures affect their own source instead of deleting case data.

This feature works locally and does not upload documents. Text is a derived aid; verify quotations, legal references and layout against originals. No releases or installed-app updates are part of this local change.
