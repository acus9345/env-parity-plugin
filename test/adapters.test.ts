import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { rollup } from "rollup";
import webpack from "webpack";
import { checkEnv, EnvParityError } from "../dist/index.js";
import { envParity as astroEnvParity, vitePlugin, type EnvParityVitePlugin } from "../dist/astro.js";
import { nextEnvFiles, withEnvParity } from "../dist/next.js";
import { envParity as rollupEnvParity } from "../dist/rollup.js";
import { EnvParityPlugin, type CompilerLike } from "../dist/webpack.js";

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

describe("watch mode", () => {
  it("webpack fails the first watch compile and only warns on rebuilds", async () => {
    const root = project({ ".env.example": "ENV_PARITY_TEST_SECRET=\n" });
    const taps: Record<string, () => Promise<void>> = {};
    const hook = (name: string) => ({
      tapPromise: (_: string, fn: (compiler: unknown) => Promise<void>) => void (taps[name] = () => fn(undefined)),
    });
    const warnings: unknown[] = [];
    new EnvParityPlugin().apply({
      context: root,
      options: { mode: "development" },
      hooks: { beforeRun: hook("beforeRun"), watchRun: hook("watchRun") },
      getInfrastructureLogger: () => ({ warn: (m: unknown) => warnings.push(m) }),
    });
    await assert.rejects(taps.watchRun!(), /ENV_PARITY_TEST_SECRET/);
    await taps.watchRun!();
    await taps.watchRun!();
    assert.equal(warnings.length, 1);
  });

  it("rollup fails the first watch build and only warns on rebuilds", () => {
    const root = project({ ".env.example": "ENV_PARITY_TEST_SECRET=\n" });
    const plugin = rollupEnvParity({ root });
    const warnings: string[] = [];
    const ctx = {
      meta: { watchMode: true },
      warn: (m: string) => void warnings.push(m),
      error: (e: Error | string): never => {
        throw e;
      },
    };
    assert.throws(() => plugin.buildStart.call(ctx), /ENV_PARITY_TEST_SECRET/);
    plugin.buildStart.call(ctx);
    plugin.buildStart.call(ctx);
    assert.equal(warnings.length, 1);
  });

  it("scopes watch state per compiler and deduplicates multiple and reappearing warnings", async () => {
    const root1 = project({ ".env.example": "ENV_PARITY_TEST_A=\n", ".env": "NOT_A_VALID_LINE\n" });
    const root2 = project({ ".env.example": "ENV_PARITY_TEST_B=\n" });
    const shared = new EnvParityPlugin();

    const makeCompiler = (root: string) => {
      const taps: Record<string, () => Promise<void>> = {};
      const warnings: unknown[] = [];
      const compiler: CompilerLike = {
        context: root,
        options: { mode: "development" },
        hooks: {
          beforeRun: { tapPromise: (_, fn) => void (taps.beforeRun = () => fn(undefined)) },
          watchRun: { tapPromise: (_, fn) => void (taps.watchRun = () => fn(undefined)) },
        },
        getInfrastructureLogger: () => ({ warn: (m) => warnings.push(m) }),
      };
      shared.apply(compiler);
      return { taps, warnings };
    };

    const c1 = makeCompiler(root1);
    const c2 = makeCompiler(root2);

    // Both compilers sharing one plugin instance must fail their own first watch compile.
    await assert.rejects(c1.taps.watchRun!(), /ENV_PARITY_TEST_A/);
    assert.equal(c1.warnings.length, 1); // parse warning from run 1
    await assert.rejects(c2.taps.watchRun!(), /ENV_PARITY_TEST_B/);

    // c1 had a parse warning on run 1, so rebuild #1 only emits the mismatch warning; rebuild #2 emits nothing.
    await c1.taps.watchRun!();
    assert.equal(c1.warnings.length, 2);
    await c1.taps.watchRun!();
    assert.equal(c1.warnings.length, 2);

    // Fix .env, rebuild cleanly, then break it again — the warning must reappear.
    writeFileSync(join(root1, ".env"), "ENV_PARITY_TEST_A=ok\n");
    await c1.taps.watchRun!();
    assert.equal(c1.warnings.length, 2);
    writeFileSync(join(root1, ".env"), "");
    await c1.taps.watchRun!();
    assert.equal(c1.warnings.length, 3);
  });

  it("rollup deduplicates multiple warnings and warns again after a fix-then-break cycle", () => {
    const root = project({ ".env.example": "ENV_PARITY_TEST_A=\n", ".env": "NOT_A_VALID_LINE\n" });
    const plugin = rollupEnvParity({ root });
    const warnings: string[] = [];
    const ctx = {
      meta: { watchMode: true },
      warn: (m: string) => void warnings.push(m),
      error: (e: Error | string): never => {
        throw e;
      },
    };
    assert.throws(() => plugin.buildStart.call(ctx), /ENV_PARITY_TEST_A/);
    assert.equal(warnings.length, 1); // parse warning from first run
    plugin.buildStart.call(ctx);
    assert.equal(warnings.length, 2); // mismatch warning (parse warning deduplicated)
    plugin.buildStart.call(ctx);
    assert.equal(warnings.length, 2); // neither warning repeated
    writeFileSync(join(root, ".env"), "ENV_PARITY_TEST_A=ok\n");
    plugin.buildStart.call(ctx);
    writeFileSync(join(root, ".env"), "");
    plugin.buildStart.call(ctx);
    assert.equal(warnings.length, 3);
  });
});

describe("option validation", () => {
  it("rejects non-object options and invalid root in rollup and next adapters", () => {
    for (const bad of [null, ["a"], "str", 123]) {
      assert.throws(
        () => rollupEnvParity(bad as never),
        (e: unknown) => e instanceof EnvParityError && e.code === "INVALID_OPTIONS" && /expects an options object/.test(e.message),
      );
      assert.throws(
        () => withEnvParity({}, bad as never),
        (e: unknown) => e instanceof EnvParityError && e.code === "INVALID_OPTIONS" && /expects an options object/.test(e.message),
      );
    }
    for (const badRoot of ["", "   ", 123, null]) {
      assert.throws(
        () => rollupEnvParity({ root: badRoot as never }),
        (e: unknown) => e instanceof EnvParityError && e.code === "INVALID_OPTIONS" && /"root" must be a folder path/.test(e.message),
      );
      assert.throws(
        () => withEnvParity({}, { root: badRoot as never }),
        (e: unknown) => e instanceof EnvParityError && e.code === "INVALID_OPTIONS" && /"root" must be a folder path/.test(e.message),
      );
    }
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

  it("fails astro dev, warns once in astro preview, and reads Vite's envDir and mode", () => {
    const root = project({ ".env.example": "PUBLIC_API=\n", ".env.staging": "PUBLIC_API=x\n" });
    assert.throws(() => setup("dev").plugin.configResolved({ root, mode: "development", envDir: root }), /failOn: "build"/);
    const { plugin, logged } = setup("preview");
    plugin.configResolved({ root, mode: "production", envDir: root });
    plugin.configResolved({ root, mode: "production", envDir: root });
    assert.equal(logged.length, 1);
    setup("dev", { failOn: "build" }).plugin.configResolved({ root, mode: "development", envDir: root });
    const staging = setup("build").plugin;
    staging.configResolved({ root, mode: "staging", envDir: root });
  });

  it("provides a typed Vite plugin array compatible with Vite/Astro config updaters", () => {
    type StrictViteResolvedConfig = {
      root: string;
      mode: string;
      envDir: string | false;
      logger: { warn(msg: string, options?: { timestamp?: boolean }): void };
    };
    type StrictVitePlugin = {
      name: string;
      configResolved?: (config: StrictViteResolvedConfig) => void | Promise<void>;
    };
    type StrictAstroHook = (opts: {
      command: "dev" | "build" | "preview" | "sync";
      logger: { warn(message: string): void };
      updateConfig: (config: { vite?: { plugins?: StrictVitePlugin[] } }) => void;
    }) => void | Promise<void>;

    const integration = astroEnvParity();
    const hook: StrictAstroHook = integration.hooks["astro:config:setup"];
    const plugins: EnvParityVitePlugin[] = [];
    hook({
      command: "preview",
      logger: { warn: () => {} },
      updateConfig: (c) => {
        if (c.vite?.plugins) plugins.push(...(c.vite.plugins as EnvParityVitePlugin[]));
      },
    });
    assert.equal(plugins.length, 1);
  });
});

describe("next", () => {
  it("fails next build and next dev, warns in next start, and returns the wrapped config", async () => {
    const root = project({ ".env.example": "DATABASE_URL=\n" });
    const config = withEnvParity({ reactStrictMode: true }, { root });
    await assert.rejects(config("phase-production-build", { defaultConfig: {} as never }), /\[env-parity-plugin\/next\] 1 variable/);
    await assert.rejects(config("phase-development-server", { defaultConfig: {} as never }), /withEnvParity\(nextConfig, \{ failOn: "build" \}\)/);
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (m: string) => logged.push(m);
    try {
      assert.deepEqual(await config("phase-production-server", { defaultConfig: {} as never }), { reactStrictMode: true });
      assert.match(logged[0]!, /DATABASE_URL/);
      // Next loads the config again in workers; the check runs once per phase.
      await config("phase-production-server", { defaultConfig: {} as never });
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

  it("does not set the dedup marker when a check fails so retrying after a fix still checks", async () => {
    const root = project({ ".env.example": "ENV_PARITY_NEXT_RETRY=\n" });
    const config = withEnvParity({ ok: true }, { root });
    try {
      await assert.rejects(config("phase-production-build", { defaultConfig: {} as never }), /ENV_PARITY_NEXT_RETRY/);
      assert.equal(process.env.ENV_PARITY_CHECKED_PHASE_PRODUCTION_BUILD, undefined);
      writeFileSync(join(root, ".env"), "ENV_PARITY_NEXT_RETRY=1\n");
      assert.deepEqual(await config("phase-production-build", { defaultConfig: {} as never }), { ok: true });
      assert.equal(process.env.ENV_PARITY_CHECKED_PHASE_PRODUCTION_BUILD, "1");
    } finally {
      for (const k of Object.keys(process.env)) if (k.startsWith("ENV_PARITY_CHECKED_")) delete process.env[k];
    }
  });
});
