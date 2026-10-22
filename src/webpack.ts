/**
 * Webpack 5 and Rspack plugin.
 *
 * @example
 * // webpack.config.js or rspack.config.js
 * import { EnvParityPlugin } from "env-parity-plugin/webpack";
 *
 * export default { plugins: [new EnvParityPlugin()] };
 */
import { resolveOptions, runCheck, type EnvParityOptions, type ResolvedOptions } from "@acus9345/env-parity";

export type { EnvParityOptions } from "@acus9345/env-parity";
export { EnvParityError } from "@acus9345/env-parity";

const NAME = "env-parity-plugin/webpack";

interface Tap {
  tapPromise(name: string, fn: (compiler: unknown) => Promise<void>): void;
}

/** The parts of a Webpack or Rspack compiler this plugin uses. */
export interface CompilerLike {
  context: string;
  options: { mode?: string | undefined };
  hooks: { beforeRun: Tap; watchRun: Tap };
  getInfrastructureLogger?(name: string): { warn(...args: unknown[]): void };
}

/**
 * Checks your env against `.env.example` before each build. A mismatch fails
 * `webpack` / `rspack build` and the first compile of watch mode and dev
 * servers; later rebuilds only warn.
 *
 * Reads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local` from the
 * compiler's `context`, plus environment variables. The mode is Webpack's
 * `mode` option (`production` when unset or `none`). If your setup loads only
 * `.env` (like dotenv-webpack), pass `envFiles: [".env"]`.
 */
export class EnvParityPlugin {
  readonly #options: ResolvedOptions;
  #lastWarning = "";
  #watchStarted = false;

  constructor(options: EnvParityOptions = {}) {
    this.#options = resolveOptions(options, { name: NAME, call: "new EnvParityPlugin", docs: "https://github.com/acus9345/env-parity-plugin#options" });
  }

  apply(compiler: CompilerLike): void {
    const check = async (watching: boolean): Promise<void> => {
      const mode = compiler.options.mode && compiler.options.mode !== "none" ? compiler.options.mode : "production";
      const logger = compiler.getInfrastructureLogger?.(NAME);
      const run = !watching ? "build" : this.#watchStarted ? "rebuild" : "dev";
      if (watching) this.#watchStarted = true;
      const { error } = runCheck(this.#options, {
        name: NAME,
        root: compiler.context,
        mode,
        run,
        hint: (option) => `new EnvParityPlugin({ ${option} })`,
        warn: (message) => {
          // Watch mode re-checks on every rebuild; only repeat a warning when it changes.
          if (watching && message === this.#lastWarning) return;
          this.#lastWarning = message;
          if (logger) logger.warn(message);
          else console.warn(message);
        },
      });
      if (error) throw error;
    };
    compiler.hooks.beforeRun.tapPromise(NAME, () => check(false));
    compiler.hooks.watchRun.tapPromise(NAME, () => check(true));
  }
}

/** Same as `new EnvParityPlugin(options)`. */
export function envParity(options: EnvParityOptions = {}): EnvParityPlugin {
  return new EnvParityPlugin(options);
}

export default EnvParityPlugin;
