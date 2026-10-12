# Third-party components

The distribution build includes only the TypeScript and translation files under `src/`. Its only external runtime import is `obsidian`, provided by the host application. Node.js packages and Obsidian's API type declarations are not bundled. The build verifies its input list and external imports.

Development dependencies are pinned in `package.json` and `pnpm-lock.yaml`. These include [Obsidian API types](https://github.com/obsidianmd/obsidian-api), [TypeScript](https://github.com/microsoft/TypeScript), [esbuild](https://github.com/evanw/esbuild), [ESLint](https://github.com/eslint/eslint) and the [Obsidian ESLint plugin](https://github.com/obsidianmd/eslint-plugin). Their upstream license files apply to those tools and dependencies; they are not replaced by this project's MIT license. The installed packages retain their notices.

Boot Booster is an independent community plugin, not an official Obsidian product. No Obsidian application code, other plugins, test vaults or Android SDK files are included in its distribution.
