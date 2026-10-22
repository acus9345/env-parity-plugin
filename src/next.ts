/**
 * Next.js config wrapper.
 *
 * @example
 * // next.config.mjs
 * import { withEnvParity } from "env-parity-plugin/next";
 *
 * export default withEnvParity({ reactStrictMode: true });
 */
import { resolveOptions, runCheck, type EnvParityOptions, type RunKind } from "@acus9345/env-parity";

export type { EnvParityOptions } from "@acus9345/env-parity";
export { EnvParityError } from "@acus9345/env-parity";

const NAME = "env-parity-plugin/next";

/** Next.js options: the shared ones plus the project root. */
export interface NextEnvParityOptions extends EnvParityOptions {
  /** Folder that holds `next.config` and the env files. @default process.cwd() */
  root?: string;
}

/** A Next.js config: an object, or a function of the phase that returns one. */
export type NextConfigInput<C> = C | ((phase: string, context: { defaultConfig: C }) => C | Promise<C>);

/**
 * How each Next.js phase maps to a mode and a kind of run. `next start` only
 * warns: public variables were inlined by `next build`, which already checked them.
 */
export const PHASES: Readonly<Record<string, { mode: string; run: RunKind } | undefined>> = {
  "phase-development-server": { mode: "development", run: "dev" },
  "phase-production-build": { mode: "production", run: "build" },
  "phase-export": { mode: "production", run: "build" },
  "phase-production-server": { mode: "production", run: "other" },
  "phase-test": { mode: "test", run: "other" },
};

/** Env files Next.js loads for a mode, lowest priority first. `.env.local` is skipped in tests, like Next does. */
export function nextEnvFiles(mode: string): string[] {
  return mode === "test" ? [".env", ".env.test", ".env.test.local"] : [".env", `.env.${mode}`, ".env.local", `.env.${mode}.local`];
}

/**
 * Wrap your Next.js config so the env is checked against `.env.example`
 * whenever Next loads it. A mismatch fails `next build` and `next dev`, and
 * is a warning in `next start` and tests.
 *
 * Reads the files Next.js loads for the phase (`.env`, `.env.[mode]`,
 * `.env.local`, `.env.[mode].local`) plus environment variables. Works with
 * config objects, functions and async functions, and with other wrappers.
 */
export function withEnvParity<C extends object>(
  nextConfig: NextConfigInput<C> = {} as C,
  options: NextEnvParityOptions = {},
): (phase: string, context: { defaultConfig: C }) => Promise<C> {
  const { root, ...rest } = options;
  const opts = resolveOptions(rest, { name: NAME, call: "withEnvParity", docs: "https://github.com/acus9345/env-parity-plugin#options" });
  return async (phase, context) => {
    const known = PHASES[phase];
    // Next.js loads the config again in worker processes; they inherit this marker, so the check runs once.
    const marker = `ENV_PARITY_CHECKED_${phase.replace(/\W/g, "_").toUpperCase()}`;
    if (known && process.env[marker] !== "1") {
      process.env[marker] = "1";
      const mode = opts.mode ?? known.mode;
      const { error } = runCheck(opts, {
        name: NAME,
        root: root ?? process.cwd(),
        mode,
        run: known.run,
        envFiles: nextEnvFiles(mode),
        framework: "next",
        hint: (option) => `withEnvParity(nextConfig, { ${option} })`,
        warn: (message) => console.warn(`⚠ ${message}`),
      });
      if (error) throw error;
    }
    return typeof nextConfig === "function" ? nextConfig(phase, context) : nextConfig;
  };
}

export default withEnvParity;
