# Boot Booster

[日本語](README.ja.md)

Faster startup for Android Obsidian vaults with many notes.

**Android only: Obsidian API 1.13.8 / 1.14.4.** Desktop and iOS are not accelerated. Other Android versions use normal startup.

## Features

- Reuse the saved file list and verify changes in the background.
- Reduce workspace restoration work and speed up reads of large plugin program files.
- Show verification progress and local startup records. Japanese and English UI.

## How it works

The first startup records a file inventory. Later startups can use it provisionally while checking real files in the background. Notes are checked before opening; writes require fresh checks. Workspace display hints reuse Obsidian's deferred views. Large plugin files use Android's local file-reading route without changing other plugins' execution order.

The plugin uses internal Obsidian APIs. Note contents are not cached. Inventories and startup records stay on this device; file reading contacts only localhost. No external data transmission or self-updates.

Search and query results may be incomplete during verification. If verification fails, set **File list optimization** to **Off** and restart. External apps' writes are not locked. Startup timings are observations, not predictions. See [testing and limitations](docs/testing.md).

## Install

In **Settings → Community plugins → Browse**, search for **Boot Booster**, install and enable it. [Community listing](https://community.obsidian.md/plugins/boot-booster).

For manual installation, download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/kgway/boot-booster/releases) into `.obsidian/plugins/boot-booster/`. Keep `data.json` when updating.

[Issues](https://github.com/kgway/boot-booster/issues) · [Text editing](docs/editing-text.md) · [Release builds](docs/releasing.md)

[MIT](LICENSE) © 2026 kgway. The license is included in the bundle. [Third-party components](THIRD_PARTY_NOTICES.md).
