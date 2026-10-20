/**
 * Fail your build when a variable from `.env.example` is missing or empty.
 *
 * Import the adapter for your tool:
 * - `env-parity-plugin/webpack`: Webpack 5 and Rspack
 * - `env-parity-plugin/rollup`: Rollup and Rolldown
 * - `env-parity-plugin/astro`: Astro
 * - `env-parity-plugin/next`: Next.js
 *
 * This entry exports the checker itself, for scripts and other tools.
 *
 * @example
 * import { checkEnv } from "env-parity-plugin";
 *
 * const result = checkEnv({ mode: "production" });
 * if (!result.ok) console.error(result.missing);
 */
import { checkEnvParity, defaultEnvFiles, formatProblems, type CheckResult } from "./core/check.js";
import { expandFiles, resolveOptions, type EnvParityOptions } from "./core/options.js";

export { checkEnvParity, defaultEnvFiles, formatProblems };
export type { CheckInput, CheckResult, CodeUse, OptionHint } from "./core/check.js";
export { EnvParityError } from "./core/errors.js";
export type { EnvParityErrorCode } from "./core/errors.js";
export type { EnvParityOptions, ScanOptions } from "./core/options.js";
export { BUILT_IN_VARIABLES, findEnvUses } from "./core/scan.js";
export type { EnvUse } from "./core/scan.js";
export { parseEnv, parseEnvDetailed } from "./core/parse.js";
export type { EnvMap, ParseIssue, ParseResult } from "./core/parse.js";

/** Options for {@link checkEnv}: the shared options plus the root and environment to check. */
export interface CheckEnvOptions extends Omit<EnvParityOptions, "failOn"> {
  /** @default process.cwd() */
  root?: string;
  /** @default process.env */
  env?: Readonly<Record<string, string | undefined>>;
  /** With `scan`, also check framework rules: `"next"` reports server-only variables read in `"use client"` files. */
  framework?: "next";
}

/**
 * Check the env against `.env.example` and return the result. Never throws
 * for a mismatch; throws {@link EnvParityError} only when the example file is
 * missing or an option is invalid.
 */
export function checkEnv(options: CheckEnvOptions = {}): CheckResult {
  const { root, env, framework, ...rest } = options;
  const opts = resolveOptions(rest, "env-parity-plugin", "checkEnv");
  const mode = opts.mode ?? process.env.NODE_ENV ?? "development";
  return checkEnvParity({
    root: root ?? process.cwd(),
    envDir: opts.envDir ?? ".",
    envFiles: expandFiles(opts.envFiles ?? defaultEnvFiles(mode), mode),
    example: opts.example,
    allowEmpty: opts.allowEmpty,
    reportExtra: opts.reportExtra,
    ignore: opts.ignore,
    processEnv: env ?? process.env,
    scan: opts.scan,
    framework,
  });
}
