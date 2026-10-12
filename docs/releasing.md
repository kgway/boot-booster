# Release builds

Normal pushes and pull requests run checks only. **Build release assets** is a manual workflow for the public repository; it never creates a tag or publishes a release.

1. Review and test the candidate. Record the SHA-256 of `main.js`, `manifest.json` and `styles.css` separately from trial ZIP documentation.
2. Merge the reviewed source after CI passes. Run **Build release assets** on `main`, providing its current full commit SHA and the three approved hashes. The workflow requires the source and workflow commit to match, and rejects malformed inputs, commits outside `main`, changed assets and a non-reproducible build. It runs type checks, tests, lint and the public-file scan before attesting and uploading the assets.
3. Download the `release-assets` artifact. Compare all three files against the candidate and verify each attestation with `gh attestation verify <file> --repo kgway/boot-booster --source-digest <full-source-sha> --signer-workflow kgway/boot-booster/.github/workflows/release-build.yml`. Attestations identify the build source; they do not certify runtime safety or community approval.
4. Create a draft release whose tag is exactly `manifest.json`'s version, without a `v` prefix, targeting that source commit. Attach only the three runtime files. Do not attach `INSTALL.md`, the trial ZIP, logs or source snapshots. README and LICENSE live in the repository; the bundle also contains the full MIT license.
5. Download the draft attachments, compare their hashes and verify attestations again, then publish. Check the published tag, attachments and download URLs. Never replace a published version's tag or attachments; use a new version for changes.

The first community submission uses [Obsidian's Community directory](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin). GitHub publication and directory review are separate. The maintainer must link their account, review their public profile and agree to the developer policies in the official form. Do not mark the plugin as listed before checking its actual directory state.
