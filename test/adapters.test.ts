import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { rollup } from "rollup";
import webpack from "webpack";
import { checkEnv, EnvParityError } from "../dist/index.js";
import { envParity as astroEnvParity, vitePlugin } from "../dist/astro.js";
import { nextEnvFiles, withEnvParity } from "../dist/next.js";
import { envParity as rollupEnvParity } from "../dist/rollup.js";
import { EnvParityPlugin } from "../dist/webpack.js";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "env-parity-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.js"), "export const x = 1;\n");
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const noEnv = {} as Record<string, string | undefined>;

describe("checkEnv", () => {
  it("finds missing, empty and undocumented variables", () => {
    const root = project({ ".env.example": "API_URL=\nTOKEN=\nDEBUG=\n", ".env": "API_URL=https://x\nTOKEN=\nEXTRA=1\n" });
    const r = checkEnv({ root, env: noEnv, mode: "production", reportExtra: true });
    assert.deepEqual([r.ok, r.missing, r.empty, r.extra], [false, ["DEBUG"], ["TOKEN"], ["EXTRA"]]);
    assert.equal(checkEnv({ root, env: { DEBUG: "1", TOKEN: "t" }, mode: "production" }).ok, true);
    assert.equal(checkEnv({ root, env: noEnv, ignore: ["DEB*", "TOKEN"] }).ok, true);
  });

  it("reads mode files and lets later files win", () => {
    const root = project({ ".env.example": "A=\n", ".env": "A=\n", ".env.production.local": "A=set\n" });
    assert.equal(checkEnv({ root, env: noEnv, mode: "production" }).ok, true);
    assert.deepEqual(checkEnv({ root, env: noEnv, mode: "development" }).empty, ["A"]);
    assert.equal(checkEnv({ root, env: noEnv, envFiles: [".env", ".env.{mode}.local"], mode: "production" }).ok, true);
  });

  it("flags UTF-16 env files, which most loaders read as garbage", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("A=1\n", "utf16le")]);
    const root = project({ ".env.example": "A=\n", ".env": utf16 });
    const r = checkEnv({ root, env: noEnv });
    assert.deepEqual(r.missing, ["A"]);
    assert.deepEqual(r.badEncoding, [".env (UTF-16 LE)"]);
  });

  it("explains a missing example file and bad options", () => {
    const root = project({});
    assert.throws(() => checkEnv({ root }), (e: unknown) => e instanceof EnvParityError && e.code === "EXAMPLE_NOT_FOUND");
    assert.throws(() => checkEnv({ root, ignore: "A" as never }), /"ignore" must be an array/);
    assert.throws(() => checkEnv({ root, bogus: 1 } as never), /Unknown option "bogus"/);
  });
});

describe("webpack", () => {
  const build = (root: string, mode: "production" | "development", options = {}) =>
    new Promise<webpack.Stats | undefined>((resolve, reject) => {
      const compiler = webpack({
        context: root,
        mode,
        entry: "./index.js",
        output: { path: join(root, "dist") },
        infrastructureLogging: { level: "none" },
        plugins: [new EnvParityPlugin(options)],
      });
      compiler.run((err, stats) => compiler.close(() => (err ? reject(err) : resolve(stats))));
    });

  it("fails the build with a clear message when a variable is missing", async () => {
    const root = project({ ".env.example": "API_URL=\nENV_PARITY_TEST_SECRET=\n", ".env": "API_URL=https://x\n" });
    await assert.rejects(build(root, "production"), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /\[env-parity-plugin\/webpack\] 1 variable from \.env\.example is not set \(mode "production"\)/);
      assert.match(e.message, /Missing: +ENV_PARITY_TEST_SECRET/);
      assert.match(e.message, /new EnvParityPlugin\(\{ ignore: \["NAME"\] \}\)/);
      return true;
    });
  });

  it("passes when everything is set, and honours the mode", async () => {
    const root = project({ ".env.example": "API_URL=\n", ".env.development": "API_URL=http://localhost\n" });
    const stats = await build(root, "development", { failOn: "always" });
    assert.equal(stats?.hasErrors(), false);
    await assert.rejects(build(root, "production"));
  });

  it("only warns with failOn: never", async () => {
    const root = project({ ".env.example": "ENV_PARITY_TEST_MISSING=\n" });
    const stats = await build(root, "production", { failOn: "never" });
    assert.equal(stats?.hasErrors(), false);
  });
});

describe("rollup", () => {
  it("fails the build when a variable is missing", async () => {
    const root = project({ ".env.example": "ENV_PARITY_TEST_SECRET=\n" });
    await assert.rejects(
      rollup({ input: join(root, "index.js"), plugins: [rollupEnvParity({ root })], onwarn: () => {} }),
      /\[env-parity-plugin\/rollup\] 1 variable from \.env\.example is not set/,
    );
  });

  it("passes when the variable is set in .env or the environment", async () => {
    const root = project({ ".env.example": "A=\nENV_PARITY_TEST_FROM_ENV=\n", ".env": "A=1\n" });
    process.env.ENV_PARITY_TEST_FROM_ENV = "yes";
    try {
      const bundle = await rollup({ input: join(root, "index.js"), plugins: [rollupEnvParity({ root })] });
      await bundle.close();
    } finally {
      delete process.env.ENV_PARITY_TEST_FROM_ENV;
    }
  });

  it("warns instead of failing with failOn: never", async () => {
    const root = project({ ".env.example": "ENV_PARITY_TEST_SECRET=\n" });
    const warnings: string[] = [];
    const bundle = await rollup({
      input: join(root, "index.js"),
      plugins: [rollupEnvParity({ root, failOn: "never" })],
      onwarn: (w) => warnings.push(w.message),
    });
    await bundle.close();
    assert.match(warnings.join("\n"), /ENV_PARITY_TEST_SECRET/);
  });
});

describe("astro", () => {
  function setup(command: string, options = {}) {
    const added: unknown[] = [];
    const logged: string[] = [];
    astroEnvParity(options).hooks["astro:config:setup"]({
      command,
      logger: { warn: (m) => logged.push(m) },
      updateConfig: (c) => added.push(...c.vite.plugins),
    });
    return { plugin: added[0] as ReturnType<typeof vitePlugin>, logged };
  }

  it("adds a Vite plugin that fails astro build", () => {
    const root = project({ ".env.example": "PUBLIC_API=\n" });
    const { plugin } = setup("build");
    assert.equal(plugin.name, "env-parity-plugin:astro");
    assert.throws(() => plugin.configResolved({ root, mode: "production", envDir: root }), /\[env-parity-plugin\/astro\] 1 variable/);
  });

  it("warns once in astro dev, reading Vite's envDir and mode", () => {
    const root = project({ ".env.example": "PUBLIC_API=\n", ".env.staging": "PUBLIC_API=x\n" });
    const { plugin, logged } = setup("dev");
    plugin.configResolved({ root, mode: "development", envDir: root });
    plugin.configResolved({ root, mode: "development", envDir: root });
    assert.equal(logged.length, 1);
    const staging = setup("build").plugin;
    staging.configResolved({ root, mode: "staging", envDir: root });
  });
});

describe("next", () => {
  it("fails next build, warns in next dev, and returns the wrapped config", async () => {
    const root = project({ ".env.example": "DATABASE_URL=\n" });
    const config = withEnvParity({ reactStrictMode: true }, { root });
    await assert.rejects(config("phase-production-build", { defaultConfig: {} as never }), /\[env-parity-plugin\/next\] 1 variable/);
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (m: string) => logged.push(m);
    try {
      assert.deepEqual(await config("phase-development-server", { defaultConfig: {} as never }), { reactStrictMode: true });
      assert.match(logged[0]!, /DATABASE_URL/);
      // Next loads the config again in workers; the check runs once per phase.
      await config("phase-development-server", { defaultConfig: {} as never });
      assert.equal(logged.length, 1);
    } finally {
      console.warn = warn;
      for (const k of Object.keys(process.env)) if (k.startsWith("ENV_PARITY_CHECKED_")) delete process.env[k];
    }
  });

  it("wraps config functions and reads Next's env files", async () => {
    const root = project({ ".env.example": "A=\n", ".env.local": "A=1\n" });
    const config = withEnvParity(async (phase: string) => ({ phase }), { root });
    assert.deepEqual(await config("phase-production-build", { defaultConfig: {} as never }), { phase: "phase-production-build" });
    assert.deepEqual(nextEnvFiles("test"), [".env", ".env.test", ".env.test.local"]);
    for (const k of Object.keys(process.env)) if (k.startsWith("ENV_PARITY_CHECKED_")) delete process.env[k];
  });
});
