import {
  EnvParityError,
  resolveOptions,
  type OptionsSource,
  type ResolvedOptions,
  type RunKind,
} from "@acus9345/env-parity";

export const DOCS_URL = "https://github.com/acus9345/env-parity-plugin#options";

/** Validate an adapter options object that also accepts `root`, then resolve the shared options. */
export function resolveRootOptions<T extends { root?: unknown }>(
  options: T,
  source: OptionsSource,
): { root: string | undefined; opts: ResolvedOptions } {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    resolveOptions(options, source);
  }
  const { root, ...rest } = options;
  const opts = resolveOptions(rest, source);
  if (root !== undefined && (typeof root !== "string" || root.trim() === "")) {
    const got = JSON.stringify(root) ?? String(root);
    throw new EnvParityError(
      "INVALID_OPTIONS",
      `[${source.name}] "root" must be a folder path, but got ${got}. See ${source.docs ?? DOCS_URL}`,
    );
  }
  return { root, opts };
}

/**
 * Track watch-mode state for a single bundler instance so the first compile
 * runs as `"dev"` and later rebuilds run as `"rebuild"` with warning deduplication.
 */
export function createWatchRunner() {
  let watchStarted = false;
  let previousWarnings = new Set<string>();

  return function runWithWatch<T>(
    watching: boolean,
    emitWarn: (message: string) => void,
    fn: (run: RunKind, warn: (message: string) => void) => T,
  ): T {
    const run: RunKind = !watching ? "build" : watchStarted ? "rebuild" : "dev";
    if (watching) watchStarted = true;
    const currentWarnings = new Set<string>();
    const warn = (message: string): void => {
      currentWarnings.add(message);
      if (watching && previousWarnings.has(message)) return;
      emitWarn(message);
    };
    try {
      return fn(run, warn);
    } finally {
      previousWarnings = currentWarnings;
    }
  };
}
