# Document text and content search — local prototype

Lexo also indexes existing external directories without creating cases: see [LEGACY-SEARCH.md](LEGACY-SEARCH.md).

Lexo extracts text from registered DOCX and text-based PDF documents in a background worker. Original files remain authoritative. No document text is uploaded or sent to an AI service by this feature. The existing Codex handoff uses local context files.

Each case keeps `.lexo/text/<document-id>.txt` and an adjacent JSON manifest. The manifest records the original path, source SHA-256, size, modification time, extraction version, text checksum, extraction time, status and warnings. The TXT includes source locations: PDF file-page numbers and DOCX XML paragraph/table positions. These are not Word's rendered page numbers. DOCX extraction covers body paragraphs, tables, headers, footers, footnotes, endnotes and comments where present. Tracked deletions and field codes are omitted. Complex layouts, drawings, annotations, signatures and numbering need checking in the original.

The case-context file lists each document's fresh text path and status. `.lexo/TEXT-SEARCH.md` explains how agents should use the copies and verify references. New AGENTS.md files point to that guide. Existing user guidance and memories are preserved. Case context is refreshed when an AI action opens the case; text copies and their manifests update independently in the background.

## Freshness and failures

- Checks run on startup, on focus, every five seconds, and after source-file watch events. Recent saves are deferred. Fingerprints and before/after checks prevent publishing text from a file that changed during extraction.
- Successful copies are written atomically. Modified generated copies are rebuilt from originals.
- Failed extraction retains previous text but marks it unusable as current evidence. Search excludes stale, failed and missing-document content. Missing originals retain their records.
- PDFs with no extractable text are marked Needs OCR. Partly empty PDFs remain searchable for available pages but flag gaps. Empty pages can be scans or genuinely blank. OCR is not implemented yet.
- Text opens only a fresh copy. Refresh text rebuilds the derived index and re-extracts registered documents. It never deletes originals, case records, memories or skills.

## Search and storage

The derived `.lexo-search.sqlite` index sits at the workspace root, separate from `lexo.sqlite`. FTS5 indexes source sections and whole documents. Queries use Unicode word tokens with prefix matching. All terms must occur in a section or somewhere in the document. Section locations are preferred; cross-section matches are labelled Whole document instead of inventing a page reference.

Search returns excerpts with filters for bank, branch, document type, date and case. Archived cases are excluded. Up to 100 distinct content-matched documents are returned, with an indication when limited. Metadata and existing client-name search remain available. A separate read connection serves search while the worker parses and indexes.

Case-document text copies are included in existing encrypted backups and recovery copies. The derived index is omitted and rebuilt after restore. Extraction stops before backup, workspace moves and restores. The main case database schema is unchanged.

Limits: 100 MB per original, 2,000 PDF pages, 12 MB extracted text, and bounded DOCX XML parts. Worker memory and idle-time limits stop runaway extraction. Password-protected, unsupported and damaged files show failures. Semantic search and OCR are future work.

Dependencies and packaging settings are prepared for future releases. This work remains local: verification uses Node tests and pnpm dev, with no executable generated.
