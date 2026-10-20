import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Where a variable is read in the source code. */
export interface EnvUse {
  key: string;
  /** `path/to/file.ts:12`, relative to the root. */
  at: string;
  /** The file is a Next.js client component (`"use client"`). */
  client: boolean;
}

export interface ScanResult {
  uses: EnvUse[];
  /** `process.env[name]` or `const { A } = process.env` in client files: Next.js can't inline these. */
  dynamicClient: string[];
  /** Files that were read. */
  files: number;
}

export interface ScanInput {
  root: string;
  /** Files or folders to scan, relative to the root. */
  paths: readonly string[];
  /** Folder or file names (or root-relative paths) to skip. */
  exclude: readonly string[];
}

/** Source files that can read env variables. */
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
/** Never scanned: dependencies, build output and caches. */
export const DEFAULT_SCAN_EXCLUDE: readonly string[] = [
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".output", ".svelte-kit", ".astro",
  ".vercel", ".netlify", ".turbo", ".cache", "coverage", "public", "vendor",
];
const MAX_FILE_SIZE = 1024 * 1024;

const KEY = "[A-Za-z_][A-Za-z0-9_]*";
const ENV_OBJECT = String.raw`(?:process\.env|import\.meta\.env)`;
const DOT = new RegExp(String.raw`\b${ENV_OBJECT}\.(${KEY})\b`, "g");
const BRACKET = new RegExp(String.raw`\b${ENV_OBJECT}\[\s*(["'\`])(${KEY})\1\s*\]`, "g");
const DESTRUCTURE = new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${ENV_OBJECT}\b`, "g");
const DYNAMIC = new RegExp(String.raw`\bprocess\.env\[(?!\s*["'\`]${KEY}["'\`]\s*\])`, "g");
const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;

/**
 * Blanks out comments (keeping line breaks) so commented-out code doesn't
 * count. Skips over strings and template literals, so `"src/**\/*.ts"` or a
 * URL is never mistaken for a comment.
 */
export function stripComments(code: string): string {
  const out = code.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // "template" while inside `...`, "brace" while inside ${...} or nested braces within it.
  const stack: Array<"template" | "brace"> = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (stack.at(-1) === "template") {
      if (c === "\\") i += 2;
      else if (c === "`") {
        stack.pop();
        i++;
      } else if (c === "$" && code[i + 1] === "{") {
        stack.push("brace");
        i += 2;
      } else i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n && code[i] !== c && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "`") {
      stack.push("template");
      i++;
    } else {
      if (stack.at(-1) === "brace") {
        if (c === "{") stack.push("brace");
        else if (c === "}") stack.pop();
      }
      i++;
    }
  }
  return out.join("");
}

/** Finds env reads in one file's source. */
export function findEnvUses(code: string, file: string): { uses: EnvUse[]; dynamicClient: string[] } {
  const client = USE_CLIENT.test(code);
  const text = stripComments(code);
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const uses: EnvUse[] = [];
  const add = (key: string, index: number) => uses.push({ key, at: `${file}:${lineOf(index)}`, client });

  for (const m of text.matchAll(DOT)) add(m[1]!, m.index);
  for (const m of text.matchAll(BRACKET)) add(m[2]!, m.index);
  const dynamicClient: string[] = [];
  for (const m of text.matchAll(DESTRUCTURE)) {
    for (const part of m[1]!.split(",")) {
      const key = part.trim().split(/\s*[:=]\s*/)[0]!.replace(/^["']|["']$/g, "");
      if (key && !key.startsWith("...") && new RegExp(`^${KEY}$`).test(key)) add(key, m.index);
    }
    if (client) dynamicClient.push(`${file}:${lineOf(m.index)}`);
  }
  if (client) for (const m of text.matchAll(DYNAMIC)) dynamicClient.push(`${file}:${lineOf(m.index)}`);
  uses.sort((a, b) => a.at.localeCompare(b.at, undefined, { numeric: true }));
  return { uses, dynamicClient };
}

const cache = new Map<string, { mtimeMs: number; size: number; result: ReturnType<typeof findEnvUses> }>();

/** Scans source files for env reads. Unchanged files are served from a cache, so watch-mode rebuilds stay fast. */
export function scanSource(input: ScanInput): ScanResult {
  const root = resolve(input.root);
  const skip = new Set(input.exclude.map((e) => e.replace(/[\\/]+$/, "").split(/[\\/]/).join("/")));
  const isSkipped = (path: string, name: string) => skip.has(name) || skip.has(relative(root, path).split(sep).join("/"));
  const result: ScanResult = { uses: [], dynamicClient: [], files: 0 };

  const visit = (path: string) => {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return;
    }
    const name = path.split(/[\\/]/).at(-1) ?? "";
    if (stat.isDirectory()) {
      if (path !== root && isSkipped(path, name)) return;
      let entries: string[];
      try {
        entries = readdirSync(path);
      } catch {
        return;
      }
      for (const entry of entries.sort()) visit(join(path, entry));
      return;
    }
    if (!stat.isFile() || !SOURCE.test(name) || /\.d\.[cm]?ts$/.test(name) || /\.min\.js$/.test(name)) return;
    if (stat.size > MAX_FILE_SIZE || isSkipped(path, name)) return;
    const rel = relative(root, path).split(sep).join("/");
    let hit = cache.get(path);
    if (!hit || hit.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) {
      hit = { mtimeMs: stat.mtimeMs, size: stat.size, result: findEnvUses(readFileSync(path, "utf8"), rel) };
      cache.set(path, hit);
    }
    result.files++;
    result.uses.push(...hit.result.uses);
    result.dynamicClient.push(...hit.result.dynamicClient);
  };

  for (const p of input.paths) visit(resolve(root, p));
  return result;
}

/**
 * Variables tools and platforms set themselves, which never belong in
 * `.env.example`. `*` is a wildcard.
 */
export const BUILT_IN_VARIABLES: readonly string[] = [
  "NODE_ENV", "NODE_OPTIONS", "NODE_DEBUG", "CI", "TZ", "HOME", "PATH", "PWD", "npm_*",
  "NEXT_RUNTIME", "NEXT_PHASE", "NEXT_DEPLOYMENT_ID", "__NEXT_*", "TURBOPACK",
  "VERCEL", "VERCEL_*", "NEXT_PUBLIC_VERCEL_*", "NETLIFY", "CF_PAGES*",
  "MODE", "DEV", "PROD", "SSR", "BASE_URL", "SITE", "ASSETS_PREFIX",
];
