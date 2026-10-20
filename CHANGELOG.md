# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/acus9345/env-parity-plugin/releases/tag/v0.2.0
[0.1.0]: https://github.com/acus9345/env-parity-plugin/releases/tag/v0.1.0
