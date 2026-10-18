# env-parity-plugin

Fail your Webpack, Rspack, Rollup, Rolldown, Astro or Next.js build when a variable listed in `.env.example` is missing or empty, so it doesn't silently become `undefined` in production. Zero dependencies.

[![npm](https://img.shields.io/npm/v/env-parity-plugin)](https://www.npmjs.com/package/env-parity-plugin)
[![CI](https://github.com/acus9345/env-parity-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/env-parity-plugin/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/env-parity-plugin)](LICENSE)

The same check as [vite-plugin-env-parity](https://www.npmjs.com/package/vite-plugin-env-parity), for the other tools.

- **Zero config:** your existing `.env.example` is the schema.
- **Reads what your tool reads:** the `.env` files each tool loads for the current mode, plus environment variables, so it works in CI.
- **Friendly in dev:** production builds fail, dev servers and watch mode only warn.
- **Catches Windows encoding traps:** `.env` files saved as UTF-16 (what `>` does in Windows PowerShell) or with a BOM.
- Works with Turbopack too, because the Next.js check runs when the config loads, not inside the bundler.

## Install

```sh
npm install --save-dev env-parity-plugin
```

## Set up

List the variables your app needs in `.env.example` (values are optional):

```ini
API_URL=
SENTRY_DSN=
```

Then add the adapter for your tool.

### Webpack 5 or Rspack

```js
// webpack.config.js (or rspack.config.js)
import { EnvParityPlugin } from "env-parity-plugin/webpack";

export default {
  // ...
  plugins: [new EnvParityPlugin()],
};
```

Reads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local` from the compiler's `context`, where the mode is Webpack's `mode` (`production` when unset). `webpack` / `rspack build` fail on a mismatch; `--watch` and the dev server warn.

### Rollup or Rolldown

```js
// rollup.config.js (or rolldown.config.js)
import envParity from "env-parity-plugin/rollup";

export default {
  input: "src/index.js",
  plugins: [envParity()],
};
```

Same files as above, from the current directory (or `root`). The mode is `NODE_ENV`, or `production` for builds and `development` with `-w`.

### Astro

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import envParity from "env-parity-plugin/astro";

export default defineConfig({
  integrations: [envParity()],
});
```

Astro loads env files through Vite, so the check reads the same files Vite does, honours `--mode` and Vite's `envDir`. `astro build` fails, `astro dev` warns.

### Next.js

```js
// next.config.mjs
import { withEnvParity } from "env-parity-plugin/next";

export default withEnvParity({
  reactStrictMode: true,
});
```

It also wraps config functions and other wrappers: `withEnvParity(withMDX(config))`. The check reads the files Next.js loads for the phase (`.env`, `.env.[mode]`, `.env.local`, `.env.[mode].local`; no `.env.local` in tests). `next build` fails, `next dev` and `next start` warn.

## What a failure looks like

```text
[env-parity-plugin/webpack] 1 variable from .env.example is not set (mode "production").
  Missing:        SENTRY_DSN
How to fix:
  - Set the missing variables in .env, .env.local, .env.production, .env.production.local or as environment variables (e.g. in your CI settings).
  - To skip a variable on purpose, use new EnvParityPlugin({ ignore: ["NAME"] }).
```

## Options

Every adapter takes the same options:

```js
envParity({
  example: ".env.example",
  failOn: "build",
  allowEmpty: false,
  reportExtra: false,
  ignore: [],
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `example` | `.env.example` in `envDir` | File that lists the required variables. |
| `failOn` | `"build"` | `"build"`: fail production builds, warn in dev and watch mode. `"always"`: fail every run. `"never"`: only warn. |
| `allowEmpty` | `false` | Accept variables that are set but empty (`KEY=`). |
| `reportExtra` | `false` | Also report variables in your env files that the example doesn't list, so it stays up to date. |
| `ignore` | `[]` | Variables to skip. `*` is a wildcard: `["SENTRY_*"]`. |
| `envDir` | project root | Folder with the env files, or `false` to check environment variables only. |
| `envFiles` | the tool's convention | Env file names, lowest priority first. `{mode}` becomes the mode: `[".env", ".env.{mode}"]`. Use `[".env"]` with dotenv-webpack's defaults. |
| `mode` | from the tool | Mode for `.env.{mode}` files. |

The Rollup and Next.js adapters also take `root` (default: the current directory).

## Use it from a script

The root export runs the same check without a bundler, for a CI step or a custom tool:

```js
import { checkEnv, formatProblems } from "env-parity-plugin";

const result = checkEnv({ mode: "production" });
if (!result.ok) {
  console.error(formatProblems(result, { root: process.cwd(), mode: "production", hint: (o) => `{ ${o} }` }));
  process.exit(1);
}
```

`result` has `missing`, `empty`, `extra`, `badEncoding` and `warnings` arrays. For a command-line version with GitHub secrets support, see [envgap](https://www.npmjs.com/package/envgap).

## License

MIT
