/**
 * Fail your build or dev server when a variable from `.env.example` is missing or empty.
 *
 * Import the adapter for your tool:
 * - `env-parity-plugin/webpack`: Webpack 5 and Rspack
 * - `env-parity-plugin/rollup`: Rollup and Rolldown
 * - `env-parity-plugin/astro`: Astro
 * - `env-parity-plugin/next`: Next.js
 *
 * This entry re-exports the checker from `@acus9345/env-parity`, the core
 * every adapter (and vite-plugin-env-parity) shares, for scripts and other tools.
 *
 * @example
 * import { checkEnv } from "env-parity-plugin";
 *
 * const result = checkEnv({ mode: "production" });
 * if (!result.ok) console.error(result.missing);
 */
export {
  BUILT_IN_VARIABLES,
  checkEnv,
  checkEnvParity,
  defaultEnvFiles,
  EnvParityError,
  findEnvUses,
  formatProblems,
  parseEnv,
  parseEnvDetailed,
} from "@acus9345/env-parity";
export type {
  CheckEnvOptions,
  CheckInput,
  CheckResult,
  CodeUse,
  EnvMap,
  EnvParityErrorCode,
  EnvParityOptions,
  EnvUse,
  FailOn,
  OptionHint,
  ParseIssue,
  ParseResult,
  ScanOptions,
} from "@acus9345/env-parity";
