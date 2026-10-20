import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { checkEnv, findEnvUses, formatProblems } from "../dist/index.js";
import { withEnvParity } from "../dist/next.js";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "env-parity-scan-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const env = { API_URL: "x", NEXT_PUBLIC_SITE: "y", SECRET: "z", DATABASE_URL: "d" };

describe("findEnvUses()", () => {
  it("finds dot, bracket, destructured and import.meta.env reads", () => {
    const code = [
      "const a = process.env.API_URL;",
      'const b = process.env["TOKEN"] ?? process.env[`OTHER`];',
      "const { DB_HOST, DB_PORT: port = '5432', ...rest } = process.env;",
      "const c = import.meta.env.VITE_KEY;",
      "// const old = process.env.COMMENTED_OUT;",
      "/* process.env.ALSO_COMMENTED */",
      'const glob = "src/**/*.ts"; const later = process.env.AFTER_GLOB;',
      "const url = `${process.env.IN_TEMPLATE}/path`; // http://example.com",
    ].join("\n");
    const { uses } = findEnvUses(code, "a.ts");
    assert.deepEqual(
      uses.map((u) => `${u.key}@${u.at}`).sort(),
      ["AFTER_GLOB@a.ts:7", "API_URL@a.ts:1", "DB_HOST@a.ts:3", "DB_PORT@a.ts:3", "IN_TEMPLATE@a.ts:8", "OTHER@a.ts:2", "TOKEN@a.ts:2", "VITE_KEY@a.ts:4"],
    );
  });

  it("detects client components and dynamic access in them", () => {
    const client = findEnvUses('"use client";\nconst k = "SECRET";\nconst v = process.env[k];\nconst w = process.env.SECRET;', "c.tsx");
    assert.equal(client.uses[0]!.client, true);
    assert.deepEqual(client.dynamicClient, ["c.tsx:3"]);
    const server = findEnvUses("// header\nconst v = process.env[k];", "s.ts");
    assert.deepEqual(server.dynamicClient, []);
  });
});

describe("scan", () => {
  it("fails when code reads a variable the example doesn't list", () => {
    const root = project({
      ".env.example": "API_URL=\n",
      "src/api.ts": "export const url = process.env.API_URL;\nexport const key = process.env.STRIPE_KEY;\nconst mode = process.env.NODE_ENV;\n",
      "src/other.ts": "process.env.STRIPE_KEY;\n",
      "node_modules/pkg/index.js": "process.env.IGNORED_IN_DEPS;\n",
      "dist/out.js": "process.env.IGNORED_IN_BUILD;\n",
    });
    const r = checkEnv({ root, env, scan: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.undeclared, [{ key: "STRIPE_KEY", at: ["src/api.ts:2", "src/other.ts:1"] }]);
    const text = formatProblems(r, { root, mode: "production", hint: (o) => `{ ${o} }` });
    assert.match(text, /Your code reads a variable that \.env\.example does not list/);
    assert.match(text, /Undeclared: {5}STRIPE_KEY \(src\/api\.ts:2, src\/other\.ts:1\)/);
    // Without scan, the old behaviour is unchanged.
    assert.equal(checkEnv({ root, env }).ok, true);
    // ignore applies to scanned variables too.
    assert.equal(checkEnv({ root, env, scan: true, ignore: ["STRIPE_*"] }).ok, true);
  });

  it("limits the scan with paths and exclude", () => {
    const root = project({
      ".env.example": "API_URL=\n",
      "src/a.ts": "process.env.API_URL;\n",
      "scripts/seed.ts": "process.env.SEED_ONLY;\n",
    });
    assert.equal(checkEnv({ root, env, scan: { paths: ["src"] } }).ok, true);
    assert.equal(checkEnv({ root, env, scan: { exclude: ["scripts"] } }).ok, true);
    assert.equal(checkEnv({ root, env, scan: true }).ok, false);
  });

  it("warns about unused example variables when asked", () => {
    const root = project({ ".env.example": "API_URL=\nDATABASE_URL=\n", "src/a.ts": "process.env.API_URL;\n" });
    const r = checkEnv({ root, env, scan: { unused: true } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.unused, ["DATABASE_URL"]);
    assert.match(r.warnings.join("\n"), /no source file reads: DATABASE_URL/);
    assert.deepEqual(checkEnv({ root, env, scan: true }).unused, []);
  });

  it("checks Next.js client components", () => {
    const root = project({
      ".env.example": "NEXT_PUBLIC_SITE=\nSECRET=\n",
      "app/page.tsx": "export default function Page() { return process.env.SECRET; }\n",
      "app/button.tsx": "'use client';\nexport const site = process.env.NEXT_PUBLIC_SITE;\nexport const s = process.env.SECRET;\nexport const m = process.env.NODE_ENV;\n",
    });
    const r = checkEnv({ root, env, scan: true, framework: "next" });
    assert.deepEqual(r.clientOnly, [{ key: "SECRET", at: ["app/button.tsx:3"] }]);
    assert.match(formatProblems(r, { root, mode: "production", hint: (o) => o }), /Only variables starting with NEXT_PUBLIC_ reach the browser/);
    // Without framework: "next", client files are not special.
    assert.equal(checkEnv({ root, env, scan: true }).ok, true);
  });

  it("fails next build through withEnvParity", async () => {
    const root = project({
      ".env.example": "SECRET=\n",
      "app/client.tsx": '"use client";\nconsole.log(process.env.SECRET);\n',
    });
    const saved = { ...process.env };
    try {
      process.env.SECRET = "s";
      delete process.env.ENV_PARITY_CHECKED_PHASE_PRODUCTION_BUILD;
      const config = withEnvParity({}, { root, scan: true });
      await assert.rejects(config("phase-production-build", { defaultConfig: {} }), /In client code: SECRET \(app\/client\.tsx:2\)/);
    } finally {
      process.env = saved;
    }
  });

  it("validates scan options", () => {
    const root = project({ ".env.example": "A=\n" });
    assert.throws(() => checkEnv({ root, scan: "yes" as never }), /"scan" must be true, false or an object/);
    assert.throws(() => checkEnv({ root, scan: { path: ["src"] } as never }), /Unknown scan option "path"/);
    assert.throws(() => checkEnv({ root, scan: { paths: "src" } as never }), /"scan.paths" must be an array/);
  });
});
