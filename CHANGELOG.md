# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- `env-parity-plugin/webpack`: `EnvParityPlugin` for Webpack 5 and Rspack. Fails builds, warns in watch mode.
- `env-parity-plugin/rollup`: plugin for Rollup 3/4 and Rolldown.
- `env-parity-plugin/astro`: integration that checks the files Astro's Vite loads, honouring `--mode` and `envDir`.
- `env-parity-plugin/next`: `withEnvParity()` config wrapper that checks the files Next.js loads per phase, once per phase across worker processes. Works with Turbopack.
- `checkEnv()`, `checkEnvParity()`, `formatProblems()` and `parseEnv()` for scripts.
- Options `example`, `failOn`, `allowEmpty`, `reportExtra`, `ignore`, `envDir`, `envFiles` and `mode`, validated with helpful errors.
- Detection of UTF-16 and BOM-encoded env files.

[0.1.0]: https://github.com/acus9345/env-parity-plugin/releases/tag/v0.1.0
