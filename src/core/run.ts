import { checkEnvParity, defaultEnvFiles, formatProblems, type CheckResult, type OptionHint } from "./check.js";
import { EnvParityError } from "./errors.js";
import { expandFiles, type ResolvedOptions } from "./options.js";

/** What an adapter knows about the current run. */
export interface RunContext {
  /** Name shown in messages, e.g. `env-parity-plugin/webpack`. */
  name: string;
  root: string;
  mode: string;
  /** Whether this is a production build (fails under `failOn: "build"`). */
  isBuild: boolean;
  /** Env file convention for this tool, lowest priority first. */
  envFiles?: readonly string[];
  /** Where this tool keeps env files, when it has its own setting (like Vite's `envDir`). */
  envDir?: string | false;
  hint: OptionHint;
  warn: (message: string) => void;
}

/** Outcome of {@link runCheck}: a message to throw, or nothing. */
export interface RunOutcome {
  result: CheckResult | undefined;
  /** Set when the run should fail; the caller throws it the way its tool expects. */
  error: EnvParityError | undefined;
}

/** Run the check for an adapter: warn or produce an error depending on `failOn`. */
export function runCheck(opts: ResolvedOptions, ctx: RunContext, processEnv: Readonly<Record<string, string | undefined>> = process.env): RunOutcome {
  const fail = opts.failOn === "always" || (opts.failOn === "build" && ctx.isBuild);
  const mode = opts.mode ?? ctx.mode;
  const input = {
    root: ctx.root,
    envDir: opts.envDir ?? ctx.envDir ?? ".",
    envFiles: expandFiles(opts.envFiles ?? ctx.envFiles ?? defaultEnvFiles(mode), mode),
    example: opts.example,
    allowEmpty: opts.allowEmpty,
    reportExtra: opts.reportExtra,
    ignore: opts.ignore,
    processEnv,
  };

  let result: CheckResult;
  try {
    result = checkEnvParity(input);
  } catch (err) {
    if (err instanceof EnvParityError) {
      const tagged = new EnvParityError(err.code, `[${ctx.name}] ${err.message}`);
      if (fail) return { result: undefined, error: tagged };
      ctx.warn(tagged.message);
      return { result: undefined, error: undefined };
    }
    throw err;
  }

  for (const warning of result.warnings) ctx.warn(`[${ctx.name}] warning: ${warning}`);
  if (result.ok) return { result, error: undefined };
  const message = `[${ctx.name}] ${formatProblems(result, { root: ctx.root, mode, hint: ctx.hint })}`;
  if (fail) return { result, error: new EnvParityError("ENV_MISMATCH", message) };
  ctx.warn(message);
  return { result, error: undefined };
}
