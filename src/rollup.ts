/**
 * Rollup (3 and 4) and Rolldown plugin.
 *
 * @example
 * // rollup.config.js
 * import envParity from "env-parity-plugin/rollup";
 *
 * export default { input: "src/index.js", plugins: [envParity()] };
 */
import { EnvParityError, runCheck, type EnvParityOptions } from "@acus9345/env-parity";
import { createWatchRunner, DOCS_URL, resolveRootOptions } from "./shared.js";

export type { EnvParityOptions } from "@acus9345/env-parity";
export { EnvParityError };

const NAME = "env-parity-plugin/rollup";

/** Rollup plugin options: the shared ones plus the project root. */
export interface RollupEnvParityOptions extends EnvParityOptions {
  /** Folder the env and example files are relative to. @default process.cwd() */
  root?: string;
}

/** The parts of Rollup's plugin context this plugin uses. */
interface PluginContextLike {
  meta?: { watchMode?: boolean };
  warn(message: string): void;
  error(error: Error | string): never;
}

/** A Rollup / Rolldown plugin object. */
export interface EnvParityRollupPlugin {
  name: string;
  buildStart(this: PluginContextLike): void;
}

/**
 * Checks your env against `.env.example` when the build starts. A mismatch
 * fails `rollup -c` and the first build of `rollup -c -w`; later rebuilds only
 * warn.
 *
 * Reads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local`, plus
 * environment variables. The mode is `NODE_ENV`, or `production` for builds
 * and `development` in watch mode.
 */
export function envParity(options: RollupEnvParityOptions = {}): EnvParityRollupPlugin {
  const { root, opts } = resolveRootOptions(options, { name: NAME, call: "envParity", docs: DOCS_URL });
  const runWithWatch = createWatchRunner();
  return {
    name: "env-parity",
    buildStart() {
      const watching = this.meta?.watchMode === true;
      runWithWatch(watching, (message) => this.warn(message), (run, warn) => {
        const { error } = runCheck(opts, {
          name: NAME,
          root: root ?? process.cwd(),
          mode: process.env.NODE_ENV || (watching ? "development" : "production"),
          run,
          hint: (option) => `envParity({ ${option} })`,
          warn,
        });
        if (error) this.error(error);
      });
    },
  };
}

export default envParity;
