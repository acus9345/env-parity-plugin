/**
 * Astro integration.
 *
 * @example
 * // astro.config.mjs
 * import { defineConfig } from "astro/config";
 * import envParity from "env-parity-plugin/astro";
 *
 * export default defineConfig({ integrations: [envParity()] });
 */
import { resolveOptions, type EnvParityOptions, type ResolvedOptions } from "./core/options.js";
import { runCheck } from "./core/run.js";

export type { EnvParityOptions } from "./core/options.js";
export { EnvParityError } from "./core/errors.js";

const NAME = "env-parity-plugin/astro";

interface LoggerLike {
  warn(message: string): void;
}

/** The parts of Astro's `astro:config:setup` hook this integration uses. */
export interface AstroSetupLike {
  command: string;
  logger?: LoggerLike;
  updateConfig(config: { vite: { plugins: unknown[] } }): unknown;
}

/** The parts of Vite's resolved config the inner plugin reads. */
export interface ViteConfigLike {
  root: string;
  mode: string;
  envDir?: string | false;
  logger?: { warn(message: string): void };
}

/** An Astro integration object. */
export interface EnvParityAstroIntegration {
  name: string;
  hooks: { "astro:config:setup": (options: AstroSetupLike) => void };
}

/**
 * Checks your env against `.env.example` when Astro starts. A mismatch fails
 * `astro build` and is a warning in `astro dev`.
 *
 * Astro loads env files through Vite, so this reads the same files Vite does
 * (`.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` in Vite's
 * `envDir`), honours `--mode`, and adds environment variables on top.
 */
export function envParity(options: EnvParityOptions = {}): EnvParityAstroIntegration {
  const opts = resolveOptions(options, NAME, "envParity");
  return {
    name: "env-parity-plugin",
    hooks: {
      "astro:config:setup": ({ command, logger, updateConfig }) => {
        updateConfig({ vite: { plugins: [vitePlugin(opts, command, logger)] } });
      },
    },
  };
}

/** The Vite plugin the integration adds; exported for tests and custom setups. */
export function vitePlugin(opts: ResolvedOptions, command: string, logger?: LoggerLike) {
  let checked = false;
  return {
    name: "env-parity-plugin:astro",
    configResolved(config: ViteConfigLike) {
      // `astro build` resolves several Vite configs (server and client). One check is enough.
      if (checked) return;
      checked = true;
      const { error } = runCheck(opts, {
        name: NAME,
        root: config.root,
        mode: config.mode,
        isBuild: command === "build",
        envDir: config.envDir ?? config.root,
        hint: (option) => `envParity({ ${option} })`,
        warn: (message) => (logger ?? config.logger ?? console).warn(message),
      });
      if (error) throw error;
    },
  };
}

export default envParity;
