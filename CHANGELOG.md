# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.3.1] - 2026-10-22

0.3.0 and 0.3.1 contain the same code. npm held the 0.3.0 publish for about ten minutes, so the changes below were released again as 0.3.1 before 0.3.0 appeared. Either version works; 0.3.1 is `latest`.

### Changed

- **The default `failOn` is now `"start"`:** a mismatch fails dev-server starts as well as production builds (`next dev`, `astro dev`, the first compile of `webpack --watch` / `webpack serve`, the first build of `rollup -w`). Watch-mode rebuilds, `next start`, `astro preview` and tests still only warn. To keep the 0.2 behaviour, pass `failOn: "build"`. When a dev start fails, the message says so.
- The checker now lives in [@acus9345/env-parity](https://www.npmjs.com/package/@acus9345/env-parity), the core shared with vite-plugin-env-parity. This package depends on it and re-exports `checkEnv`, `checkEnvParity`, `formatProblems`, `parseEnv` and the rest from its root entry, so imports keep working.

### Added

- `failOn: "start"`, and the `FailOn` and `CheckEnvOptions` types.

## [0.2.0] - 2026-10-20

### Added

- `scan` option: reads `process.env.X`, `process.env["X"]`, `import.meta.env.X` and `const { X } = process.env` in your source files and fails when the code reads a variable that `.env.example` doesn't list, with the file and line of each read. Takes `true` or `{ paths, exclude, unused }`.
- Next.js: with `scan`, server-only variables read in `"use client"` files fail the build (they are `undefined` in the browser), and dynamic `process.env` access in client files is a warning.
- `scan: { unused: true }` warns about example variables that no source file reads.
- `CheckResult` has `undeclared`, `clientOnly` and `unused`; `checkEnv()` takes `framework: "next"`; `findEnvUses()` and `BUILT_IN_VARIABLES` are exported.

## [0.1.0] - 2026-10-18

### Added

- `env-parity-plugin/webpack`: `EnvParityPlugin` for Webpack 5 and Rspack. Fails builds, warns in watch mode.
- `env-parity-plugin/rollup`: plugin for Rollup 3/4 and Rolldown.
- `env-parity-plugin/astro`: integration that checks the files Astro's Vite loads, honouring `--mode` and `envDir`.
- `env-parity-plugin/next`: `withEnvParity()` config wrapper that checks the files Next.js loads per phase, once per phase across worker processes. Works with Turbopack.
- `checkEnv()`, `checkEnvParity()`, `formatProblems()` and `parseEnv()` for scripts.
- Options `example`, `failOn`, `allowEmpty`, `reportExtra`, `ignore`, `envDir`, `envFiles` and `mode`, validated with helpful errors.
- Detection of UTF-16 and BOM-encoded env files.

[0.3.1]: https://github.com/acus9345/env-parity-plugin/releases/tag/v0.3.1
[0.2.0]: https://github.com/acus9345/env-parity-plugin/releases/tag/v0.2.0
[0.1.0]: https://github.com/acus9345/env-parity-plugin/releases/tag/v0.1.0
