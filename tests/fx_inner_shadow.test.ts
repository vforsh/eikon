import { test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSharp } from "../src/image";

async function runEikon(args: string[]) {
  const proc = Bun.spawn({
    cmd: ["./index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function createTransparentSquareFixture() {
  const sharp = await loadSharp();
  const fixturePath = join(tmpdir(), `eikon-inner-shadow-input-${Date.now()}.png`);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="16" y="16" width="32" height="32" rx="0" ry="0" fill="#ffffff" />
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(fixturePath);
  return fixturePath;
}

test("eikon fx inner-shadow darkens interior edge without changing canvas size", async () => {
  const inputPath = await createTransparentSquareFixture();
  const outPath = join(tmpdir(), `eikon-inner-shadow-output-${Date.now()}.png`);

  const { code, stdout, stderr } = await runEikon([
    "fx",
    "inner-shadow",
    inputPath,
    "--out",
    outPath,
    "--opacity",
    "1",
    "--blur",
    "0",
    "--spread",
    "0",
    "--dx",
    "0",
    "--dy",
    "4",
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.width).toBe(64);
  expect(parsed.height).toBe(64);
  expect(parsed.innerShadow.dy).toBe(4);

  const sharp = await loadSharp();
  const { data, info } = await sharp(outPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  expect(info.width).toBe(64);
  expect(info.height).toBe(64);

  const pixelAt = (x: number, y: number) => {
    const idx = (y * info.width + x) * info.channels;
    return {
      r: data[idx + 0],
      g: data[idx + 1],
      b: data[idx + 2],
      a: data[idx + 3],
    };
  };

  const outside = pixelAt(8, 8);
  const center = pixelAt(32, 24);
  const bottomInterior = pixelAt(32, 47);

  expect(outside.a).toBe(0);
  expect(center.r).toBe(255);
  expect(center.g).toBe(255);
  expect(center.b).toBe(255);
  expect(center.a).toBe(255);
  expect(bottomInterior.r).toBeLessThan(255);
  expect(bottomInterior.g).toBeLessThan(255);
  expect(bottomInterior.b).toBeLessThan(255);
  expect(bottomInterior.a).toBe(255);
});
