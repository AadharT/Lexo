# Lexo 0.5.1

- Move document search into an independent read-only worker, with cancellation and timeout recovery.
- Page through all global document results with exact totals and 25, 50 or 100 rows per page. Add pagination to case lists and per-case document lists.
- Rank documents before selecting excerpts and index section lookups for the visible page.
- Replace workspace reloads during background indexing with throttled status snapshots and stable data revisions.
- Avoid document filesystem scans during UI refreshes, repeated idle text hashing and nested case/document joins on every keystroke.

Existing cases and originals stay in their workspace. Derived search indexes upgrade in the background. See PERFORMANCE.md for local measurements and validation scope.

# Lexo 0.5.0

- Review a case with AI in Codex, with local case context, memories and skill folders.
- Create and register a Word document before handing its drafting request to Codex.
- Change case status directly from its case screen.
- Extract local text copies from PDF and DOCX documents and search their contents with source references.
- Register legacy directories, index their documents without creating cases or changing originals, and filter search by source. Pause, resume, rescan and safely remove directories; preserve records when drives disconnect.
- Integrate the Windows title bar into the app header, with native window controls and theme support.

Original documents remain authoritative. Scanned PDFs need OCR, which is not yet included. Workspace backups retain external-directory registrations but do not back up external originals or their rebuildable text cache; back up those originals separately.

The update replaces the installed application executable. Existing cases, workspace settings and original documents remain in their current workspace. Derived search indexes rebuild as needed.
