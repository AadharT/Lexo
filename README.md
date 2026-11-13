# Lexo 0.4.0

Single-computer case and document management for a legal firm. Electron, React/Vite and SQLite. This release adds firm setup, workspace settings, themes, firm lists, custom case fields, readable document paths, and a Lexo app icon.

## Run

Use the prepared **Lexo-desktop/Lexo.cmd** launcher. The portable build is **release/Lexo-0.4.0-win-x64.exe**. Read [DATA-SAFETY.md](DATA-SAFETY.md) for updates, workspace locations, backups and future-release requirements. This is an unsigned prototype build.

For development, double-click **Start-Lexo.cmd**, or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\lexo.ps1 dev
```

Node.js 24.22.1 and pnpm 11.25.0 are installed locally in `.runtime/`; Electron and development dependencies are installed in `node_modules/`. The launch scripts prefer the local runtime. React uses Fast Refresh; changes in `electron/` restart the desktop process. Closing the desktop window stops the development server.

On another Windows x64 machine, install Node.js 24 or newer and pnpm 11.25.0, then run setup:

```powershell
npm install -g pnpm@11.25.0
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\lexo.ps1 setup
```

Setup installs locked dependencies and downloads the official Electron runtime with checksum verification. Internet access is required for initial downloads. The local runtime folders are excluded from source control.

## First-run firm setup

Enter the firm name, workspace name, and select an **empty folder** for the workspace. Choose Light, Dark, or System appearance. Setup is completed once per workspace.

The selected folder contains the SQLite database and all managed case documents. A small `workspace.json` pointer in Electron's per-user application-data directory remembers its location. If that folder is on a disconnected drive, Lexo reports it as unavailable instead of silently creating a different empty workspace.

**Settings → Firm & workspace** lets you rename the firm/workspace and change the workspace folder. Changing folders copies the library to an empty destination and preserves the original. Save and close Word documents before changing folders. This is a local workspace, without firm accounts or shared access.

## Interface and settings

- Light, Dark, and System themes use the same copper accent and spacing/layout system.
- Theme changes are saved immediately; the top-bar theme button is a quick explicit light/dark override.
- Firm and workspace names replace the old placeholder identity. The native window title includes the firm name.
- Settings is anchored to the bottom of the left sidebar.
- A custom Lexo icon is used in the interface, native window and Windows executable.
- Sidebar/top-bar filler text and marketing captions have been removed.

Settings sections: **Firm & workspace**, **Appearance**, **Banks & branches**, **Case fields**, **Statuses & types**, and **Backup & restore**.

## Cases and firm lists

Cases have an automatic reference and created date, case name, client, bank, branch, status and notes. **Case name, Bank, Branch and Status are required; Client is optional.** These rules are enforced in the form and storage when saving. Cases can be edited, searched, filtered, archived, and restored from archive.

Banks and branches are firm-wide managed lists. Each branch belongs to a bank. Case forms use dropdowns and clear the branch when a different bank is selected. Status and document-type dropdowns also use firm lists. Options in use cannot be removed. Add missing choices inline or in Settings. **Manage firm lists** temporarily preserves an in-progress case form and provides a return button.

## Searchable, creatable dropdowns

Native selects have been replaced throughout the interface with one shared dropdown control: aligned chevrons, theme-matched menus, selected-item checkmarks, scrollable lists, and popovers that stay above dialogs and flip upward when space is limited. Long lists are searchable. Keyboard support includes direct typing, arrows, Enter, Escape, Tab and type-ahead for short fixed lists. Required dropdowns preserve form validation.

In case and document forms, bank, branch, status, document type and custom dropdown choices always offer search. Type a name, then select a match or choose **Create “name”**. Creation saves the option to the workspace-wide list and selects it without discarding the form. A branch is created under the selected bank.

Matching ignores letter case, repeated/leading/trailing whitespace and equivalent Unicode width forms. Existing display spelling is preserved. The same matching rules run in SQLite-backed storage operations, including Settings, so UI bypasses cannot create case variants through the supported app API. Custom dropdown choices also use these rules.

Multi-word search matches all entered words consistently. Full names such as `state bank of india` work with mixed case and extra spaces; exact and prefix bank matches rank first. Directory results are associated with the query that produced them and are not discarded by a second, narrower display-label filter. This also preserves branch results found through an address or across city/name fields. Existing caches work without downloading the directory again.

## Connected bank directory

Lexo connects to the [Razorpay IFSC dataset](https://github.com/razorpay/ifsc), which aggregates published bank/branch reference data. On first launch without a cache, it automatically downloads the latest published release in the background. **Settings → Banks & branches** displays progress and provides **Download directory / Check for updates**.

The download is about 36 MB for the verified release. Its SHA-256 digest and size are checked against GitHub release metadata. A worker builds a local SQLite index, validates it, and swaps it into service only after completion. A failed update leaves the previous cache available. Case operations remain usable during downloads/indexing.

Bank fields search bank names and codes. Branch fields search branches, cities, states, addresses and IFSC codes within the selected bank. Suggestions show location and IFSC. Selecting a suggestion adds only that bank/branch to the firm list. Manual creation remains available, with case/whitespace matching, and existing records are preserved. A directory branch cannot be selected under the wrong bank.

Bank-name and sublet-bank mappings are used to determine bank ownership; IFSC prefixes alone are insufficient for every record. Imported branch names include city and IFSC to distinguish similarly named branches. The workspace stores IFSC, source bank code, original branch name, city, state, address and source release alongside the selected branch. The same IFSC is reused when selected again.

After download, all searches work offline. The reference cache is stored separately in the app's per-user `reference/bank-directory.sqlite`, while the chosen workspace retains selected firm entries and their metadata. The public cache is rebuildable and is not included in workspace backups; selected bank/branch metadata is included. A restored workspace can use its saved entries before downloading the reference directory again.

Settings displays the source version, publication date, download date and counts. An update does not silently rename or reassign existing case records. Reference data may include historical records; the source release date is visible. No case information or documents are sent to the directory provider.

Validated against release `v2.0.62`, published 1 September 2026: **183,214 branch records** across **1,406 source bank-code records**. These are reference-record counts, not a claim that every institution or IFSC is currently active. Future releases are fetched from the provider's latest-release endpoint. The [RBI official IFSC lists](https://rbi.org.in/Scripts/bs_viewcontent.aspx?Id=2009) remain the authoritative source for independent verification.

## Custom case fields

In **Settings → Case fields**, create:

- Text and long text
- Number and currency (INR)
- Date
- Dropdown with firm-defined choices
- Checkbox

Fields can be required, searchable, and filterable. They appear in case forms and details. Search includes values of active searchable fields. Filters include numeric/currency ranges, date ranges, dropdown equality, checkbox Yes/No, and text matching. The first two filterable custom fields also appear as case-list columns.

Values are stored in typed SQLite columns with indexes. Case saves validate required values, valid dates/numbers, and dropdown choices. A field with saved values cannot change type; used dropdown choices cannot be removed. Fields can be edited or archived. Archiving retains historical values, which remain visible in existing case details. Custom labels cannot shadow core case fields.

## Documents and readable folders

Import PDFs/DOCX files or create a new Word document from a case. Lexo owns a managed copy; it does not rely on an external Desktop/Downloads link. Document records contain relative paths.

New paths are readable and Windows-safe, for example:

```text
<selected workspace>/
  lexo.sqlite
  cases/
    LEX-0001 - SBI Recovery Mehta - a12bc345/
      documents/
        Demand notice first draft - d67ef890.docx
        Court order - e12ab345.pdf
```

Descriptive names precede a short permanent ID to avoid filename ambiguity. Unsupported filename characters are sanitised. The database uses full UUIDs. Folder/file names are stable after creation: changing a case name does not move existing documents. Existing UUID-named files/folders are left alone; this release does not rename them.

**Open** launches the default Windows application for the file. Word must be installed and associated with DOCX for it to open in Word. Ctrl+S saves directly to the managed file. **Save As** creates a separate file; import it to register that copy in Lexo. **Show in folder** reveals the managed file. Do not move or rename managed files manually.

Global document search covers titles, types, case references, case names and clients. Filters include bank, branch, document type and upload-date range. File sizes/modification times refresh when Lexo regains focus. PDFs open externally. Document content search/OCR, in-app editing and automatic document version history remain future work. Individual imports are limited to 100 MB.

## Backup and Google Drive

1. Sign in to Google Drive for desktop, or use an external/local backup drive.
2. In **Settings → Backup & restore**, select a dedicated backup folder outside the live workspace.
3. Enter a password of at least 12 characters and keep a recovery copy separately.
4. Save and close Word documents; select **Save & back up**.
5. If using Drive, verify its cloud sync completes.

Backups include a consistent SQLite snapshot (`VACUUM INTO`), every registered document, workspace settings, firm lists and custom fields. A SHA-256 manifest validates entries. Archives use AES-256-GCM with a scrypt-derived key and random salt/nonce. Passwords stay in memory by default; optionally remember one using Windows-account-protected storage in the separate user profile. The live workspace is not application-encrypted.

Daily automatic backups run while Lexo is open and unlocked. Re-enter the password after restarting unless secure password remembering is enabled. A check runs once a minute and creates a snapshot if the last successful backup is at least 24 hours old. Errors appear in Settings. Snapshot retention is manual. This is not an unattended Windows service or direct Drive OAuth integration: Lexo confirms local writing, while Drive handles uploading.

Restore verifies archive authentication, hashes, SQLite integrity/schema and document presence before replacing the active library. It preserves the previous library in a sibling recovery folder. An incorrect password leaves the active workspace unchanged. Large archives are processed in memory; assess real document volumes before production deployment.

## Build and test

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\lexo.ps1 test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\lexo.ps1 build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\lexo.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\lexo.ps1 package
```

**Build-Lexo.cmd** builds the portable Windows x64 executable. Build downloads may be required for the first packaging run. Windows icon/metadata resources are applied; no signing certificate is configured. Standard pnpm scripts are also available.

## Architecture

- `electron/store.cjs`: SQLite, firm lists, typed fields, managed paths, workspace copying, encrypted backups/restore.
- `electron/main.cjs`: workspace pointer/setup, native theme/title/icon, IPC, directory coordination, file/folder dialogs and default-app launching.
- `electron/bank-directory.cjs`, `electron/directory-cache.cjs`, `electron/directory-worker.cjs`: verified background updates, atomic cache replacement, CSV parsing, offline indexes and directory search. Worker/cache modules are unpacked alongside the packaged app.
- `electron/preload.cjs`: explicit renderer API.
- `src/App.jsx`: case/document navigation, views, search and typed filters.
- `src/Workspace.jsx`: first-run and workspace settings.
- `src/Settings.jsx`: appearance, firm lists, field builder and backups.
- `src/BankingField.jsx`, `src/DirectoryPanel.jsx`: directory-backed pickers, selective import and source/download status.
- `src/Dropdown.jsx`, `src/dropdown.css`, `src/dropdown-create.css`: shared accessible menus, searching, positioning, inline creation and validation.
- `src/Forms.jsx`, `src/ui.jsx`, `src/theme.css`: shared controls, forms and theme tokens.
- `assets/`: matching SVG, PNG and Windows ICO icons.
- `tests/store.test.cjs`, `tests/directory.test.cjs`: thirty storage/validation/recovery/directory/profile tests.

The renderer is sandboxed with context isolation and no Node integration. IPC is checked against the main frame. Production uses a restrictive CSP, blocked navigation/new windows, and no remote UI content. Development allows inline scripts for Fast Refresh. Windows software rendering avoids incompatible graphics-driver crashes on this machine.

Set `LEXO_DATA_DIR` to an absolute test-specific path to isolate app configuration from real client data.

## Validation

Thirty tests pass, covering persistence, firm-list enforcement, full-name/multi-word/case/whitespace matching, required bank/branch and optional client, inline custom choices, typed-field validation, safe readable filenames, preserved workspace copies, imports, encrypted backup/restore, CSV quoting/newlines, sublet ownership, IFSC disambiguation, selected-metadata backups, partial-import rejection and failed-update offline fallback.

Desktop integration checks pass for onboarding, selected root persistence, firm/window titles, themes, dependent bank/branch dropdowns, field creation, typed values, custom-field search/range/dropdown filters, DOCX generation, encrypted backup and restart persistence, with no renderer errors. Light/dark previews are included as `Lexo-light.png` and `Lexo-dark.png` using fictional test data.

React Fast Refresh was verified to preserve the typed search query. The packaged Windows app was separately checked for onboarding, workspace selection, saved firm/theme settings and Word-document generation. Packaged backend/icon files match the verified source. SHA-256 checksums are provided in `release/SHA256SUMS.txt`.

Dropdown desktop checks cover inline bank/branch/status/document-type/custom-choice creation, case-insensitive reuse, branch resets, required validation, search, keyboard selection, Escape within dialogs, Tab focus, outside-click dismissal, popover bounds, vertical arrow alignment and returning focus after creation. Preview files: `Lexo-dropdown-dark.png` and `Lexo-dropdown-light.png`.

The live release was downloaded and checksum-verified. Source and packaged desktop checks pass for bank-code/city/IFSC suggestions, correct bank scope, selective firm-list imports, manual-entry preservation, source status and offline restart. The packaged app's cold-start worker download/indexing passed while case creation stayed responsive. An unchanged-release check reused the cache without re-downloading it. Directory previews: `Lexo-directory-search.png` and `Lexo-directory-settings.png`.

The 0.3.1 desktop regression check types `state bank of india`, mixed-case/extra-space variants and reordered words; verifies address-only branch search results; checks missing Bank and Branch are blocked; and saves a case with Client left empty.

The supplied GitHub repository was unavailable to this machine; this remains a local source deliverable and has not been pushed.
