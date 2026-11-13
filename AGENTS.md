Use `pnpm dev` for routine development and testing. It provides renderer hot reload and Electron restarts and uses an isolated development profile.

Distribute executables only through GitHub releases. Do not build local executables for routine testing. Local packaging is permitted when specifically testing executable generation, packaging, or release behaviour.

Keep one installed `Lexo.exe` in the installation root. The updater verifies downloads and atomically replaces it; do not retain old executables, downloads, version folders, or an application pointer. Users launch the executable directly.

Preserve existing workspace data and documents. Never test against the live firm workspace. Keep credentials, databases, backups and documents out of Git.
