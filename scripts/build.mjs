import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

mkdirSync(dist, { recursive: true });

const staticFiles = [
  "manifest.json",
  join("src", "ui.css"),
  join("src", "print.css"),
  join("options", "options.html"),
];

for (const file of staticFiles) {
  const fileName = file.includes("/") ? file.split("/").pop() : file;
  copyFileSync(join(root, file), join(dist, fileName));
}

const ctx = await esbuild.context({
  entryPoints: ["content", "background", "options"].map(name => join(root, "src", `${name}.ts`)),
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome109",
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Built dist/");
}
