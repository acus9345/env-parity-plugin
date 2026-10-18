/**
 * Next.js config wrapper.
 *
 * @example
 * // next.config.mjs
 * import { withEnvParity } from "env-parity-plugin/next";
 *
 * export default withEnvParity({ reactStrictMode: true });
 */
import { resolveOptions, type EnvParityOptions } from "./core/options.js";
import { runCheck } from "./core/run.js";

export type { EnvParityOptions } from "./core/options.js";
export { EnvParityError } from "./core/errors.js";

const NAME = "env-parity-plugin/next";

/** Next.js options: the shared ones plus the project root. */
export interface NextEnvParityOptions extends EnvParityOptions {
  /** Folder that holds `next.config` and the env files. @default process.cwd() */
  root?: string;
}

/** A Next.js config: an object, or a function of the phase that returns one. */
export type NextConfigInput<C> = C | ((phase: string, context: { defaultConfig: C }) => C | Promise<C>);

/** How each Next.js phase maps to a mode, and whether it counts as a build. */
export const PHASES: Readonly<Record<string, { mode: string; isBuild: boolean } | undefined>> = {
  "phase-development-server": { mode: "development", isBuild: false },
  "phase-production-build": { mode: "production", isBuild: true },
  "phase-export": { mode: "production", isBuild: true },
  "phase-production-server": { mode: "production", isBuild: false },
  "phase-test": { mode: "test", isBuild: false },
};

/** Env files Next.js loads for a mode, lowest priority first. `.env.local` is skipped in tests, like Next does. */
export function nextEnvFiles(mode: string): string[] {
  return mode === "test" ? [".env", ".env.test", ".env.test.local"] : [".env", `.env.${mode}`, ".env.local", `.env.${mode}.local`];
}

/**
 * Wrap your Next.js config so the env is checked against `.env.example`
 * whenever Next loads it. A mismatch fails `next build` and is a warning in
 * `next dev` and `next start`.
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
  const opts = resolveOptions(rest, NAME, "withEnvParity");
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
        isBuild: known.isBuild,
        envFiles: nextEnvFiles(mode),
        hint: (option) => `withEnvParity(nextConfig, { ${option} })`,
        warn: (message) => console.warn(`⚠ ${message}`),
      });
      if (error) throw error;
    }
    return typeof nextConfig === "function" ? nextConfig(phase, context) : nextConfig;
  };
}

export default withEnvParity;
