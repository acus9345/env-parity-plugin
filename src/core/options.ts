import { EnvParityError } from "./errors.js";

/** Options shared by every adapter. Every option is optional. */
export interface EnvParityOptions {
  /**
   * Path to the file that lists the required variables. Relative paths are
   * resolved from the project root.
   * @default ".env.example" in `envDir`
   */
  example?: string;
  /**
   * When a mismatch should stop the tool:
   * - `"build"`: fail production builds, only warn in dev servers and watch mode
   * - `"always"`: fail every run
   * - `"never"`: only warn
   * @default "build"
   */
  failOn?: "build" | "always" | "never";
  /** Accept variables that are set but empty (`KEY=`). @default false */
  allowEmpty?: boolean;
  /** Also report variables in your env files that the example does not list. @default false */
  reportExtra?: boolean;
  /** Variables to skip. `*` is a wildcard, e.g. `["SENTRY_*"]`. @default [] */
  ignore?: readonly string[];
  /** Folder that holds the env files, relative to the project root, or `false` to read only environment variables. @default the project root */
  envDir?: string | false;
  /**
   * Env file names to read, lowest priority first. `{mode}` becomes the mode.
   * @default each adapter's convention, e.g. `[".env", ".env.local", ".env.{mode}", ".env.{mode}.local"]`
   */
  envFiles?: readonly string[];
  /** Mode used for `.env.{mode}` files. @default worked out from the tool (production for builds, development for dev servers) */
  mode?: string;
  /**
   * Also scan your source code for `process.env.X` and `import.meta.env.X`.
   * A variable the code reads but the example doesn't list fails like a missing
   * one, and so does a server-only variable read in a Next.js `"use client"`
   * file. `true` scans the whole project (minus node_modules and build output).
   * @default false
   */
  scan?: boolean | ScanOptions;
}

/** Fine-tuning for {@link EnvParityOptions.scan}. */
export interface ScanOptions {
  /** Files or folders to scan, relative to the project root. @default ["."] */
  paths?: readonly string[];
  /** Folder or file names (or root-relative paths) to skip, on top of node_modules, dist, .next and other build output. @default [] */
  exclude?: readonly string[];
  /**
   * Warn about variables in the example that no source file reads. Off by
   * default because libraries often read variables themselves (like Prisma's
   * `DATABASE_URL`). @default false
   */
  unused?: boolean;
}

/** Scan settings with defaults filled in. */
export interface ResolvedScan {
  paths: string[];
  exclude: string[];
  unused: boolean;
}

export interface ResolvedOptions {
  example: string | undefined;
  failOn: "build" | "always" | "never";
  allowEmpty: boolean;
  reportExtra: boolean;
  ignore: string[];
  envDir: string | false | undefined;
  envFiles: string[] | undefined;
  mode: string | undefined;
  scan: ResolvedScan | undefined;
}

const KNOWN = ["example", "failOn", "allowEmpty", "reportExtra", "ignore", "envDir", "envFiles", "mode", "scan"];
const SCAN_KNOWN = ["paths", "exclude", "unused"];

/** Check options and fill in defaults. Throws {@link EnvParityError} with a fix for anything wrong. */
export function resolveOptions(options: unknown, name: string, call: string): ResolvedOptions {
  const bad = (message: string) =>
    new EnvParityError("INVALID_OPTIONS", `[${name}] ${message} See https://github.com/acus9345/env-parity-plugin#options`);

  if (options === undefined) options = {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw bad(`${call}() expects an options object, e.g. ${call}({ failOn: "always" }), but got ${kind(options)}.`);
  }
  const o = options as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!KNOWN.includes(key)) throw bad(`Unknown option "${key}". Valid options are: ${KNOWN.join(", ")}.`);
  }
  if (o.example !== undefined && (typeof o.example !== "string" || o.example.trim() === "")) {
    throw bad(`"example" must be a file path such as ".env.example", but got ${kind(o.example)}.`);
  }
  const failOn = o.failOn ?? "build";
  if (failOn !== "build" && failOn !== "always" && failOn !== "never") {
    throw bad(`"failOn" must be "build", "always" or "never", but got ${kind(failOn)}.`);
  }
  for (const flag of ["allowEmpty", "reportExtra"] as const) {
    if (o[flag] !== undefined && typeof o[flag] !== "boolean") throw bad(`"${flag}" must be true or false, but got ${kind(o[flag])}.`);
  }
  const ignore = o.ignore ?? [];
  if (!Array.isArray(ignore) || ignore.some((k) => typeof k !== "string")) {
    throw bad(`"ignore" must be an array of variable names, e.g. ["DEBUG", "SENTRY_*"], but got ${kind(ignore)}.`);
  }
  if (o.envDir !== undefined && o.envDir !== false && (typeof o.envDir !== "string" || o.envDir.trim() === "")) {
    throw bad(`"envDir" must be a folder path or false, but got ${kind(o.envDir)}.`);
  }
  if (o.envFiles !== undefined && (!Array.isArray(o.envFiles) || o.envFiles.some((f) => typeof f !== "string" || f === ""))) {
    throw bad(`"envFiles" must be an array of file names, e.g. [".env", ".env.{mode}"], but got ${kind(o.envFiles)}.`);
  }
  if (o.mode !== undefined && (typeof o.mode !== "string" || o.mode.trim() === "")) {
    throw bad(`"mode" must be a string such as "production", but got ${kind(o.mode)}.`);
  }
  let scan: ResolvedScan | undefined;
  if (o.scan === true) scan = { paths: ["."], exclude: [], unused: false };
  else if (o.scan !== undefined && o.scan !== false) {
    if (o.scan === null || typeof o.scan !== "object" || Array.isArray(o.scan)) {
      throw bad(`"scan" must be true, false or an object like { paths: ["src"] }, but got ${kind(o.scan)}.`);
    }
    const s = o.scan as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (!SCAN_KNOWN.includes(key)) throw bad(`Unknown scan option "${key}". Valid scan options are: ${SCAN_KNOWN.join(", ")}.`);
    }
    for (const list of ["paths", "exclude"] as const) {
      const v = s[list];
      if (v !== undefined && (!Array.isArray(v) || v.some((p) => typeof p !== "string" || p === ""))) {
        throw bad(`"scan.${list}" must be an array of paths, e.g. ["src"], but got ${kind(v)}.`);
      }
    }
    if (s.unused !== undefined && typeof s.unused !== "boolean") throw bad(`"scan.unused" must be true or false, but got ${kind(s.unused)}.`);
    scan = {
      paths: s.paths === undefined ? ["."] : [...(s.paths as string[])],
      exclude: s.exclude === undefined ? [] : [...(s.exclude as string[])],
      unused: (s.unused as boolean | undefined) ?? false,
    };
  }
  return {
    example: o.example as string | undefined,
    failOn,
    allowEmpty: (o.allowEmpty as boolean | undefined) ?? false,
    reportExtra: (o.reportExtra as boolean | undefined) ?? false,
    ignore: [...(ignore as string[])],
    envDir: o.envDir as string | false | undefined,
    envFiles: o.envFiles === undefined ? undefined : [...(o.envFiles as string[])],
    mode: o.mode as string | undefined,
    scan,
  };
}

/** Expand `{mode}` in env file names. */
export function expandFiles(files: readonly string[], mode: string): string[] {
  return files.map((f) => f.replaceAll("{mode}", mode));
}

function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "object" ? "an object" : `${typeof value} ${String(value)}`;
}
