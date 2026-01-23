import { test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getImageInfoFromBuffer } from "../src/image";

async function runEikon(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn({
    cmd: ["./index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...env,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

test("eikon placeholder generates PNG with correct dimensions", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-${Date.now()}.png`);
  const { code, stdout, stderr } = await runEikon([
    "placeholder",
    "--w",
    "400",
    "--h",
    "300",
    "--bg-color",
    "#111827",
    "--out",
    outPath,
    "--plain",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("Path:");
  expect(stdout).toContain("MIME: image/png");
  expect(stdout).toContain("Width: 400");
  expect(stdout).toContain("Height: 300");
  expect(stdout).toContain("Background: #111827");
  expect(stdout).toContain("Text: 400x300");

  const buffer = Buffer.from(await Bun.file(outPath).arrayBuffer());
  const info = await getImageInfoFromBuffer(buffer);
  expect(info.width).toBe(400);
  expect(info.height).toBe(300);
});

test("eikon placeholder generates WebP format", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-${Date.now()}.webp`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--width",
    "200",
    "--height",
    "100",
    "--bg-color",
    "#fff",
    "--out",
    outPath,
    "--plain",
  ]);

  expect(code).toBe(0);
  expect(stdout).toContain("MIME: image/webp");

  const buffer = Buffer.from(await Bun.file(outPath).arrayBuffer());
  const info = await getImageInfoFromBuffer(buffer);
  expect(info.width).toBe(200);
  expect(info.height).toBe(100);
});

test("eikon placeholder generates JPEG format", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-${Date.now()}.jpg`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "300",
    "--h",
    "200",
    "--bg-color",
    "#abcdef",
    "--out",
    outPath,
    "--plain",
  ]);

  expect(code).toBe(0);
  expect(stdout).toContain("MIME: image/jpeg");

  const buffer = Buffer.from(await Bun.file(outPath).arrayBuffer());
  const info = await getImageInfoFromBuffer(buffer);
  expect(info.width).toBe(300);
  expect(info.height).toBe(200);
});

test("eikon placeholder --json returns structured output", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-json-${Date.now()}.png`);
  const { code, stdout, stderr } = await runEikon([
    "placeholder",
    "--w",
    "512",
    "--h",
    "512",
    "--bg-color",
    "#000",
    "--text",
    "Hello World",
    "--out",
    outPath,
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.outPath).toBe(outPath);
  expect(parsed.width).toBe(512);
  expect(parsed.height).toBe(512);
  expect(parsed.bgcolor).toBe("#000");
  expect(parsed.background.type).toBe("solid");
  expect(parsed.textEffects).toBeDefined();
  expect(parsed.text).toBe("Hello World");
  expect(parsed.textColor).toBeDefined();
  expect(parsed.font).toBeDefined();
  expect(parsed.fitting).toBeDefined();
});

test("eikon placeholder supports multiline text", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-multiline-${Date.now()}.png`);
  const { code, stdout, stderr } = await runEikon([
    "placeholder",
    "--w",
    "800",
    "--h",
    "400",
    "--bg-color",
    "#eee",
    "--text",
    "Line 1\\nLine 2\\nLine 3",
    "--out",
    outPath,
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.text).toBe("Line 1\\nLine 2\\nLine 3");

  const buffer = Buffer.from(await Bun.file(outPath).arrayBuffer());
  const info = await getImageInfoFromBuffer(buffer);
  expect(info.width).toBe(800);
  expect(info.height).toBe(400);
});

test("eikon placeholder auto-contrast picks white text on dark bg", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-contrast-dark-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000000",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.textColor).toBe("#ffffff");
});

test("eikon placeholder auto-contrast picks black text on light bg", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-contrast-light-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#ffffff",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.textColor).toBe("#000000");
});

test("eikon placeholder respects explicit text-color", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-explicit-color-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--text-color",
    "#ff0000",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.textColor).toBe("#ff0000");
});

test("eikon placeholder fails without required options", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-missing-${Date.now()}.png`);

  // Missing --width/--w
  const { code: code1, stderr: stderr1 } = await runEikon([
    "placeholder",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
  ]);
  expect(code1).toBe(2);
  expect(stderr1).toContain("Missing required option: --width");

  // Missing --height/--h
  const { code: code2, stderr: stderr2 } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
  ]);
  expect(code2).toBe(2);
  expect(stderr2).toContain("Missing required option: --height");
});

test("eikon placeholder fails without background option", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-missing-bg-${Date.now()}.png`);
  const { code, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--out",
    outPath,
  ]);
  expect(code).toBe(2);
  expect(stderr).toContain("Provide one of --bg-color");
});

test("eikon placeholder fails with invalid color", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-invalid-color-${Date.now()}.png`);
  const { code, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "not-a-color",
    "--out",
    outPath,
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("Invalid hex color");
});

test("eikon placeholder fails if output exists without --force", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-exists-${Date.now()}.png`);
  await Bun.write(outPath, "existing");

  const { code, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
  ]);

  expect(code).toBe(5);
  expect(stderr).toContain("Output already exists");

  // With --force it should succeed
  const { code: code2 } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
    "--force",
  ]);
  expect(code2).toBe(0);
});

test("eikon placeholder --quiet suppresses output", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-quiet-${Date.now()}.png`);
  const { code, stdout, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
    "--quiet",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("");

  const exists = await Bun.file(outPath).exists();
  expect(exists).toBe(true);
});

test("eikon placeholder fails with unsupported format", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-bad-ext-${Date.now()}.gif`);
  const { code, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("Unsupported output format");
});

test("eikon placeholder supports 3-char hex colors", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-3hex-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#abc",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.bgcolor).toBe("#abc");
});

test("eikon placeholder supports 8-char hex colors (with alpha)", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-8hex-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#aabbccdd",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.bgcolor).toBe("#aabbccdd");
});

test("eikon placeholder auto-shrinks text to fit", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-shrink-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "50",
    "--bg-color",
    "#000",
    "--text",
    "This is a very long text that should be shrunk to fit",
    "--font-size",
    "100",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.fitting.finalFontSize).toBeLessThan(100);
});

test("eikon placeholder respects --padding", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-padding-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "200",
    "--h",
    "200",
    "--bg-color",
    "#000",
    "--padding",
    "50",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.fitting.padding).toBe(50);
});

test("eikon placeholder rejects conflicting dimension aliases", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-conflict-${Date.now()}.png`);
  const { code, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--width",
    "200",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--out",
    outPath,
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("Conflicting values");
});

test("eikon placeholder rejects multiple background options", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-bg-conflict-${Date.now()}.png`);
  const { code, stderr } = await runEikon([
    "placeholder",
    "--w",
    "100",
    "--h",
    "100",
    "--bg-color",
    "#000",
    "--bg-linear",
    "#111827,#0ea5e9,135",
    "--out",
    outPath,
  ]);
  expect(code).toBe(2);
  expect(stderr).toContain("Choose only one of --bg-color");
});

test("eikon placeholder supports linear gradient backgrounds", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-linear-${Date.now()}.png`);
  const { code, stdout, stderr } = await runEikon([
    "placeholder",
    "--w",
    "320",
    "--h",
    "200",
    "--bg-linear",
    "#111827,#0ea5e9,135",
    "--out",
    outPath,
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.background.type).toBe("linear");
  expect(parsed.background.colors).toEqual(["#111827", "#0ea5e9"]);
  expect(parsed.background.angleDeg).toBe(135);

  const buffer = Buffer.from(await Bun.file(outPath).arrayBuffer());
  const info = await getImageInfoFromBuffer(buffer);
  expect(info.width).toBe(320);
  expect(info.height).toBe(200);
});

test("eikon placeholder supports radial gradient backgrounds", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-radial-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "240",
    "--h",
    "160",
    "--bg-radial",
    "#111827,#000,50%,40%,85%",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.background.type).toBe("radial");
  expect(parsed.background.cx).toBe("50%");
  expect(parsed.background.cy).toBe("40%");
  expect(parsed.background.r).toBe("85%");
});

test("eikon placeholder applies radial defaults", async () => {
  const outPath = join(tmpdir(), `eikon-placeholder-radial-defaults-${Date.now()}.png`);
  const { code, stdout } = await runEikon([
    "placeholder",
    "--w",
    "240",
    "--h",
    "160",
    "--bg-radial",
    "#111827,#000",
    "--out",
    outPath,
    "--json",
  ]);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.background.cx).toBe("50%");
  expect(parsed.background.cy).toBe("50%");
  expect(parsed.background.r).toBe("75%");
});
