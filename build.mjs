// Bundles each extension context into dist/ and copies the static files next to it.
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const entryPoints = {
  background: "src/background/index.ts",
  content: "src/content/index.ts",
  app: "src/pages/app/index.ts",
};

// One page for History and Settings, under two names so each can open on its own tab.
const staticFiles = [
  ["src/manifest.json", "dist/manifest.json"],
  ["src/pages/app.html", "dist/history.html"],
  ["src/pages/app.html", "dist/settings.html"],
  ["src/pages/app.css", "dist/app.css"],
  ["src/icons", "dist/icons"],
];

async function copyStatic() {
  for (const [from, to] of staticFiles) await cp(from, to, { recursive: true });
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const options = {
  entryPoints,
  outdir: "dist",
  bundle: true,
  // Static content scripts can't be ES modules in MV3, so every bundle is a plain script.
  format: "iife",
  target: ["firefox140", "chrome120"],
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  plugins: [
    {
      name: "copy-static",
      setup(build) {
        build.onEnd(copyStatic);
      },
    },
  ],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
