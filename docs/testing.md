# Testing

## Compatibility

Startup optimization is enabled only on Android Obsidian API 1.13.8 and 1.14.4. Desktop and iOS are not accelerated; other Android versions use normal startup. The allowlist is maintained in `src/compatibility.ts`, and the platform checks are applied before optimization hooks are installed.

## Validation

Run `pnpm check`, `pnpm test` and `pnpm build` with the pinned dependencies. Tests use synthetic files and mocked host interfaces; they do not open a personal vault.

The official Obsidian ESLint configuration runs through `pnpm lint` and `pnpm lint:review`. Both reject all errors and warnings. Candidate creation runs the same check. Neither local lint nor CI replaces the directory's own review.

Version 1.14.5 replaces the lightweight tab preview CSS overrides with native placeholder handling. Its 182 automated tests include image-load callbacks, previews created before the option runs, locked host methods and cleanup after later wrappers. Android 16 / Obsidian 1.14.4 checks in a synthetic vault cover icon display, normal image restoration, native callbacks, unload cleanup and active-note preservation. `pnpm lint` also rejects CSS `!important`. These checks do not establish physical-device performance or compatibility with custom themes.

Version 1.14.4 adds regression coverage for active note requests arriving during verification or view loading, recovery after a failed earlier request, and repeated tab-overview taps. File checks still run before each queued note opens. Automatic deferred rerenders cannot replace a newer request. Concurrent tab-overview taps share the original native promise while inventory verification is active.

The 1.14.4 runtime passed 179 automated tests. Its production assets were checked in the same synthetic Android environment: an injected verification delay reproduces the lost active-open request in 1.14.3 and confirms it is retained in 1.14.4. Repeated early tab-overview calls share one native promise, and saved active-note selection, foreground checks, native tab rendering, note bytes and final indexes were checked. Indexes match the preserved 1.14.3 normal-startup reference. These are functional checks, not evidence of a new total-startup speed improvement. Settings UI checks from 1.14.3 were not repeated.

The 1.14.3 runtime passed 173 automated tests and functional checks in a dedicated Android 16 emulator running Obsidian 1.14.4. Its synthetic vault contained 10,011 notes, with Templater and Dataview enabled. Optimized and normal startup produced the same final note inventory, metadata and link graph; note paths and bytes were unchanged. Saved active-note selection and native tab overview behavior were checked. Language, history expansion, JSON, clear and clipboard-failure recovery were also checked at a narrow mobile width. Repeated settings updates, scope selection and render cleanup were checked using the native settings definitions.

Version 1.14.3 validates internal API boundaries, rejects malformed stored history and observes locked host methods without disrupting startup. It uses Obsidian’s searchable settings definitions on 1.13 and later, with the same settings rendered through the earlier API on older supported hosts. Current automated checks run in CI and when building a local candidate.

Regression tests cover file changes during write checks, stale verification results, pending reads, unload and re-enable, partial patch installation, inherited method restoration, large plugin reads, locked Templater protection and ordinary-path fallback. A passing test suite does not guarantee compatibility with every plugin or app version.

The emulator checks do not establish physical-device performance, synchronization safety, IME behavior or compatibility with custom themes. Clipboard success was simulated; OS clipboard integration was not tested. File-list optimization is enabled only for the Android adapter versions listed in `src/compatibility.ts`; other versions use the native scanner.

Keep detailed host reports, screenshots, raw logs and user trial approval records outside the public source export. Use synthetic data for reproductions and remove paths, note contents and old user-entered labels before sharing benchmark JSON.
