# Boot Booster

[日本語](README.ja.md)

Boot Booster reduces startup work in Android Obsidian vaults with many notes. It reuses a saved file list, checks it in the background and gives note-opening operations priority.

## Install and update

Community directory registration is pending. Until it is listed, install from [GitHub Releases](https://github.com/kgway/boot-booster/releases):

1. Back up your vault and close Obsidian.
2. Download `main.js`, `manifest.json` and `styles.css` from the same release. Put them in `.obsidian/plugins/boot-booster/` inside your vault.
3. Reopen Obsidian and enable Boot Booster in Community plugins.

For manual updates, replace only those three files; keep `data.json`. GitHub's **Source code** archives contain development files and are not install packages. `INSTALL.md` is used for trial ZIPs and is not a release attachment.

File-list optimization supports Android Obsidian API 1.13.8 and 1.14.4. Other versions use normal scanning. The first startup prepares a reference inventory. Automatic mode reuses it when the previous normal scan took at least 2.5 seconds and the scope contains at least 1,000 entries. App updates cause Automatic mode to measure again.

## Settings

Startup status shows the current task, progress, pauses and available timing comparisons in one setting item. History shows five recent runs; its small Show all link expands the same table. Copy and Clear history work while JSON is closed.

The interface follows Obsidian's language: Japanese for Japanese, English otherwise. Language can be changed immediately in the middle of the settings page. This preference stays on this device.

Hidden tabs load when opened. Startup note selection remains under Obsidian's control. Android plugin program files of at least 512 Ki characters can use a faster local reading route after their size has been observed. Code is read on every startup; other plugins keep their relative execution order. Skipping tab preview images is optional and off by default.

## Data and timing

Note contents are not cached. Inventories, view metadata, plugin file sizes and the latest 20 startup records stay on this device. The local Android file-reading route contacts only localhost. The plugin does not send data to external services or update itself.

History JSON excludes note paths, note contents and the vault name. Old records may retain user-entered labels. UI time starts at renderer navigation, not native app launch. Phase timings overlap. Comparisons use matching local observations and are reference values, not predictions of the same startup without optimization.

## Verification and recovery

The previous inventory is provisional until checked. Opening a note checks its file first; writes require fresh checks. Changes observed during a write preflight or destination check cause that operation to be refused. Folder deletion, move and copy wait until verification has finished. Search, graph and query results may be incomplete during verification; third-party indexes may continue afterward.

If verification fails, write protection remains active. Set File list optimization to Off, then restart Obsidian. To roll back, close Obsidian and restore the three backed-up plugin files, keeping `data.json`. External apps' concurrent writes are not locked by this plugin.

Boot Booster uses internal Obsidian APIs. App updates or other plugins can change these APIs; unsupported file-list versions use normal scanning. See [testing](docs/testing.md) for synthetic emulator checks and their limits. Physical-device performance, custom themes, IME and synchronization have not been comprehensively tested.

Report problems through [GitHub Issues](https://github.com/kgway/boot-booster/issues), including the Obsidian version, platform and steps to reproduce. Review copied startup records before sharing them, especially historical labels.

UI text lives in `src/locales/ja.json` and `src/locales/en.json`. See [text editing](docs/editing-text.md) for the Japanese-first editing workflow. Builds check matching keys and placeholders; translations are reviewed manually.

## Development

Use Node.js 24.19 or later and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm lint
pnpm build
pnpm check:release
```

`pnpm lint` and `pnpm lint:review` both reject all errors and warnings from the official Obsidian rules. CI checks source and reproducible builds; passing CI does not mean the plugin has passed community review. The manually dispatched release build verifies an explicit source commit and the three approved asset hashes, then produces downloadable assets and build attestations. It does not publish a release. See [release builds](docs/releasing.md).

## License

[MIT](LICENSE), copyright 2026 kgway. The full license is retained in the distributed JavaScript. See [third-party components](THIRD_PARTY_NOTICES.md) for development tools and the host API.
