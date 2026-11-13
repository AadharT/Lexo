# Keeping Lexo usable and updateable

Lexo 0.4.0 separates the application from the firm's workspace. Updating the app never replaces the database or the documents. No Windows installation, registry changes, service or built-in updater is involved.

## On your uncle's computer

Use the prepared **Lexo-desktop/Lexo.cmd** launcher from now on. Save and close Word documents and close the old Lexo window before the first launch. The first opening of an older workspace takes a verified recovery copy before upgrading it. Existing case and document names and locations are retained.

For later updates: save and close Word and Lexo, then double-click **update-lexo.cmd**. The script downloads the latest published stable release, verifies its checksum and executable version, stages it, then switches a small application pointer. The previous app executable stays on disk. It never kills Word or Lexo and never restores an older database automatically. If the download fails, the current app remains selected. If the new app cannot open the workspace, it reports the error and preserves the data; contact the developer rather than launching an older executable.

The GitHub release feed must be accessible on this computer. A private repository without authentication, or a repository with no published release, cannot provide automatic downloads. No GitHub token is embedded in the script. A developer-supplied release file and checksum can also be installed offline with `update-lexo.ps1 -ReleaseFile ... -Version ... -ExpectedSha256 ...`. The initial published release still needs to be uploaded before online updates can work.

In **Settings → Backup & restore**, select a dedicated folder synced by Google Drive for desktop or on a separate drive. Enter and separately retain a strong password, enable daily backups and optionally remember the password securely on this Windows account. Make the first backup and verify Drive has uploaded it. Daily backups require Lexo to be open; they resume after restart when the password is remembered. A local write succeeding does not establish that cloud upload completed.

## Where everything lives

```text
Lexo-desktop/                       Application only; keep the whole folder
  Lexo.cmd                         Stable launch entry point
  update-lexo.cmd                   Stable update entry point
  active.json                      Current and previous app release
  versions/0.4.0/Lexo.exe           Portable application
  downloads/                       Downloaded application releases
  logs/                            Startup results, no case contents

%APPDATA%/lexo/                     Stable Windows-user profile
  workspace.json                   Pointer to the selected workspace
  workspace.json.bak               Previous pointer
  workspace-configured.json        Prevents an accidental empty first run
  backup-secrets.json              Optional Windows-account-encrypted secret
  reference/                       Rebuildable public bank directory cache

<your chosen workspace>/           Firm data; outside the application folder
  lexo.sqlite                      Cases, lists, fields, settings and document paths
  lexo.sqlite-wal / -shm            SQLite live files; do not delete
  .lexo-workspace.json              Stable workspace identity/version
  cases/<reference - name - id>/documents/<name - id>.docx

<workspace>.lexo-recovery/          Full, verified pre-upgrade copies
<workspace>-before-restore-.../     Original library retained by restore
<your backup folder>/*.lexobak      Encrypted complete backups
```

Recovery copies on the same disk protect against upgrade mistakes; off-device backups protect against disk failure. Recovery copies and the live workspace are not application-encrypted. Retention is manual. Do not manually copy a live SQLite database by itself: use Lexo's backup, or close Lexo and Word before taking a complete filesystem copy.

## Safeguards implemented

- Ordered, transactional schema migrations; no unconditional version reset. Existing rows/columns must survive a migration. A failure rolls back the database.
- A verified full database/document recovery copy before a schema upgrade, and before a later app version first opens an already versioned workspace.
- A schema ledger and last-opened app version refuse incompatible schemas and application downgrades. This protection exists in 0.4.0 and later; older executables cannot enforce it. Use the stable launcher and retire old standalone launch shortcuts.
- Missing or corrupt workspace pointers and unavailable configured databases fail closed. No replacement empty workspace is created. Pointer backups are retained. A new profile can use **Open existing workspace** from setup; Settings offers the same action.
- A workspace writer lock, SQLite WAL with FULL synchronous writes, flushed atomic file/pointer writes, and pending-document records to recover completed interrupted imports.
- Restore validates authentication, hashes, database compatibility and document presence before switching folders. A persistent restore journal recovers an interrupted folder swap. Old, failed and incomplete copies are retained where recovery may be needed.
- Backups preserve all non-temporary files under `cases`, including unregistered Save As files. Unregistered files are preserved but do not become document records automatically. Missing registered documents block backups and pre-upgrade snapshots.
- Windows-account-protected backup passwords live in the profile, outside the workspace and its backup. You still need the actual password to restore on another computer.

These checks reduce failure risk; they cannot guarantee survival of physical disk failure or edits made externally in Word during a copy. Save and close Word before upgrades, moves, restores and backups.

## Developing future releases from your machine

Keep source in GitHub; never commit the workspace, documents, backups, secrets, local runtime or release folders. `.gitignore` excludes these, but review staged files before every push. Development defaults to `.test-data/development-profile` instead of the uncle's normal profile. `LEXO_DATA_DIR` explicitly selects another test profile.

1. Install Node 24 and pnpm 11.25.0; run `scripts/lexo.ps1 setup` for locked dependencies and verified Electron runtime.
2. Add new migrations without rewriting old ones. Prefer additive tables/columns. Do not remove or overwrite saved values. Never reset `user_version` to force an upgrade.
3. Increment `package.json` version for every distributed change, including UI-only changes. Never replace the bytes of an existing release version.
4. Run `scripts/lexo.ps1 test`, build with `scripts/lexo.ps1 package`, run `tests/updater.tests.ps1` against the built executable, then open a copied previous-version workspace with representative documents. Verify cases, field values, document hashes, backup and restore. Never test experimental migrations on the real workspace.
5. Push source and a matching `vX.Y.Z` tag. The included GitHub workflow runs the checks, builds Windows and creates a **draft** release. Review it and publish when ready. The portable asset must be named `Lexo-X.Y.Z-win-x64.exe`; the updater requires GitHub's SHA-256 asset digest.
6. Your uncle runs `update-lexo.cmd`. If startup fails, repair forward with a newer release using a copied workspace. Do not automatically switch to an old app or old data: new work could otherwise disappear.

No source has been pushed or release published by this change. Backup destination/password selection and the first real off-device backup remain user setup steps.
