import { test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getImageInfo } from "../src/image";

const MOCK_RESPONSE = "EIKON_E2E_MOCK_RESPONSE";
const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "e2e-app.png");
const TEST_CONFIG_PATH = join(tmpdir(), `eikon-test-config-${Date.now()}.toml`);

async function runEikon(args: string[], env: Record<string, string> = {}, stdin?: string) {
  const proc = Bun.spawn({
    cmd: ["./index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin ? "pipe" : undefined,
    env: {
      ...process.env,
      OPENROUTER_API_KEY: "test-key",
      EIKON_MOCK_OPENROUTER: "1",
      EIKON_CONFIG_PATH: TEST_CONFIG_PATH,
      ...env,
    },
  });

  if (stdin && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

test("eikon analyze runs with preset and prints text", async () => {
  const { code, stdout, stderr } = await runEikon([
    "analyze",
    FIXTURE_PATH,
    "--preset",
    "web-ui",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe(MOCK_RESPONSE);
});

test("eikon analyze --json returns full metadata", async () => {
  const { code, stdout, stderr } = await runEikon([
    "analyze",
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.text).toBe(MOCK_RESPONSE);
  expect(parsed.meta.image.path).toBe(FIXTURE_PATH);
  expect(parsed.meta.image.original).toBeDefined();
});

test("eikon analyze --output writes to file AND stdout", async () => {
  const outPath = join(tmpdir(), `eikon-e2e-${Date.now()}.txt`);
  const { code, stdout, stderr } = await runEikon([
    "analyze",
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--output",
    outPath,
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe(MOCK_RESPONSE);

  const text = await Bun.file(outPath).text();
  expect(text).toBe(MOCK_RESPONSE);
});

test("eikon analyze --quiet --output writes only to file", async () => {
  const outPath = join(tmpdir(), `eikon-e2e-quiet-${Date.now()}.txt`);
  const { code, stdout, stderr } = await runEikon([
    "analyze",
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--output",
    outPath,
    "--quiet"
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("");

  const text = await Bun.file(outPath).text();
  expect(text).toBe(MOCK_RESPONSE);
});

test("eikon analyze --downsize resizes image", async () => {
  const { code, stdout } = await runEikon(
    ["analyze", FIXTURE_PATH, "--preset", "web-ui", "--downsize"],
    { EIKON_TEST_IMAGE_INFO: "1" },
  );

  expect(code).toBe(0);
  // Original is 3168x2774. Default max is 2048.
  expect(stdout).toContain("w:2048");
  expect(stdout).toContain("h:1793");
});

test("eikon analyze handles invalid resize spec (exit 2)", async () => {
  const { code, stderr } = await runEikon([
    "analyze",
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--max-width",
    "abc",
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("error: Invalid --max-width");
});

test("eikon analyze handles missing API key (exit 4)", async () => {
  const { code, stderr } = await runEikon(
    ["analyze", FIXTURE_PATH, "--preset", "web-ui"],
    { OPENROUTER_API_KEY: "" }
  );

  expect(code).toBe(4);
  expect(stderr).toContain("error: Missing API key");
});

test("eikon analyze handles missing image (exit 5)", async () => {
  const { code, stderr } = await runEikon([
    "analyze",
    "non-existent.png",
    "--preset",
    "web-ui",
  ]);

  expect(code).toBe(5);
  expect(stderr).toContain("error: Image not found or not readable");
});

test("eikon presets list works", async () => {
  const { code, stdout } = await runEikon(["presets", "list"]);
  expect(code).toBe(0);
  expect(stdout).toContain("web-ui");
  expect(stdout).toContain("web-ui-layout");
});

test("eikon presets list --json works", async () => {
  const { code, stdout } = await runEikon(["presets", "list", "--json"]);
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed.some((p: any) => p.name === "web-ui")).toBe(true);
});

test("eikon config path works", async () => {
  const { code, stdout } = await runEikon(["config", "path"], { EIKON_CONFIG_PATH: "/tmp/custom.toml" });
  expect(code).toBe(0);
  expect(stdout).toContain("/tmp/custom.toml");
});

test("eikon config show --json redacts API key", async () => {
  const { code, stdout } = await runEikon(["config", "show", "--json"]);
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  if (parsed.config.apiKey) {
    expect(parsed.config.apiKey).toBe("********");
  }
});

test("eikon analyze:local shows human-readable output", async () => {
  const { code, stdout } = await runEikon(["analyze:local", FIXTURE_PATH]);
  expect(code).toBe(0);
  expect(stdout).toContain("image/png");
  expect(stdout).toContain("3168");
  expect(stdout).toContain("2774");
});

test("eikon analyze:local --plain shows stable output", async () => {
  const { code, stdout } = await runEikon(["analyze:local", FIXTURE_PATH, "--plain"]);
  expect(code).toBe(0);
  expect(stdout).toContain("Path:");
  expect(stdout).toContain("MIME:");
  expect(stdout).toContain("Width:");
  expect(stdout).toContain("Height:");
});

test("eikon analyze:local --json shows full metadata", async () => {
  const { code, stdout } = await runEikon(["analyze:local", FIXTURE_PATH, "--json"]);
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.info).toBeDefined();
  expect(parsed.info.path).toBe(FIXTURE_PATH);
  expect(parsed.info.mime).toBe("image/png");
  expect(parsed.info.width).toBe(3168);
  expect(parsed.info.height).toBe(2774);
  expect(parsed.info.bytes).toBeGreaterThan(0);
  expect(parsed.info.aspectRatio).toBeGreaterThan(0);
  expect(parsed.info.megapixels).toBeGreaterThan(8);
});

test("eikon analyze:local handles missing image (exit 5)", async () => {
  const { code, stderr } = await runEikon(["analyze:local", "non-existent.png"]);
  expect(code).toBe(5);
  expect(stderr).toContain("error: Image not found or not readable");
});

test("eikon upscale --json returns metadata", async () => {
  const outPath = join(tmpdir(), `eikon-upscale-${Date.now()}.png`);
  const info = await getImageInfo(FIXTURE_PATH);
  const { code, stdout, stderr } = await runEikon([
    "upscale",
    FIXTURE_PATH,
    "--out",
    outPath,
    "--scale",
    "2",
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.outPath).toBe(outPath);
  expect(parsed.width).toBe(info.width * 2);
  expect(parsed.height).toBe(info.height * 2);
  expect(parsed.model).toBeDefined();
});

test("eikon upscale:local writes resized image", async () => {
  const outPath = join(tmpdir(), `eikon-upscale-local-${Date.now()}.png`);
  const info = await getImageInfo(FIXTURE_PATH);
  const { code, stdout, stderr } = await runEikon([
    "upscale:local",
    FIXTURE_PATH,
    "--out",
    outPath,
    "--scale",
    "2",
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.outPath).toBe(outPath);

  const outInfo = await getImageInfo(outPath);
  expect(outInfo.width).toBe(info.width * 2);
  expect(outInfo.height).toBe(info.height * 2);
});

test("eikon upscale:local rejects downscale (exit 2)", async () => {
  const info = await getImageInfo(FIXTURE_PATH);
  const outPath = join(tmpdir(), `eikon-upscale-downscale-${Date.now()}.png`);
  const { code, stderr } = await runEikon([
    "upscale:local",
    FIXTURE_PATH,
    "--out",
    outPath,
    "--width",
    String(info.width - 10),
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("error: Downscale not allowed");
});

test("eikon generate writes image to --out", async () => {
  const outPath = join(tmpdir(), `eikon-generate-${Date.now()}`, "cat.png");
  const { code, stdout, stderr } = await runEikon([
    "generate",
    "--prompt",
    "Minimal icon of a cat",
    "--out",
    outPath,
    "--plain",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("Path:");
  expect(stdout).toContain("MIME:");
  expect(stdout).toContain("Bytes:");

  const file = Bun.file(outPath);
  expect(await file.exists()).toBe(true);
});

test("eikon generate with local --ref writes image", async () => {
  const outPath = join(tmpdir(), `eikon-generate-ref-${Date.now()}`, "out.png");
  const { code, stdout, stderr } = await runEikon([
    "generate",
    "--prompt",
    "Same style, new pose",
    "--ref",
    FIXTURE_PATH,
    "--out",
    outPath,
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.refs).toHaveLength(1);
  expect(parsed.refs[0].type).toBe("file");
  expect(parsed.refs[0].value).toBe(FIXTURE_PATH);
  expect(parsed.outPath).toBe(outPath);
  const outFile = Bun.file(outPath);
  expect(await outFile.exists()).toBe(true);
});

test("eikon generate with URL --ref works", async () => {
  const outPath = join(tmpdir(), `eikon-generate-url-${Date.now()}`, "out.png");
  const url = "https://example.com/ref.png";
  const { code, stdout, stderr } = await runEikon(
    [
      "generate",
      "--prompt",
      "Use this as composition reference",
      "--ref",
      url,
      "--out",
      outPath,
      "--json",
    ],
    { EIKON_TEST_REF_PATH: FIXTURE_PATH },
  );

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.refs).toHaveLength(1);
  expect(parsed.refs[0].type).toBe("url");
  expect(parsed.refs[0].value).toBe(url);
  expect(parsed.outPath).toBe(outPath);
  const outFile = Bun.file(outPath);
  expect(await outFile.exists()).toBe(true);
});

test("eikon generate with multiple --ref works", async () => {
  const outPath = join(tmpdir(), `eikon-generate-multi-ref-${Date.now()}`, "combined.png");
  const { code, stdout, stderr } = await runEikon([
    "generate",
    "--prompt",
    "Combine these images",
    "--ref",
    FIXTURE_PATH,
    "--ref",
    FIXTURE_PATH,
    "--out",
    outPath,
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.refs).toHaveLength(2);
  expect(parsed.refs[0].type).toBe("file");
  expect(parsed.refs[0].value).toBe(FIXTURE_PATH);
  expect(parsed.refs[1].type).toBe("file");
  expect(parsed.refs[1].value).toBe(FIXTURE_PATH);
  expect(parsed.outPath).toBe(outPath);
  const outFile = Bun.file(outPath);
  expect(await outFile.exists()).toBe(true);
});

test("eikon generate missing --prompt (exit 2)", async () => {
  const outPath = join(tmpdir(), `eikon-generate-missing-${Date.now()}`, "out.png");
  const { code, stderr } = await runEikon([
    "generate",
    "--out",
    outPath,
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("error: Missing --prompt");
});

test("eikon generate rejects relative --ref (exit 2)", async () => {
  const outPath = join(tmpdir(), `eikon-generate-relref-${Date.now()}`, "out.png");
  const { code, stderr } = await runEikon([
    "generate",
    "--prompt",
    "test",
    "--ref",
    "relative.png",
    "--out",
    outPath,
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("error: --ref path must be absolute");
});

test("eikon generate models lists image-gen models", async () => {
  const { code, stdout, stderr } = await runEikon(["generate", "models"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const lines = stdout.trim().split("\n");
  expect(lines.length).toBeGreaterThan(0);
  expect(lines).toContain("google/gemini-3-pro-image-preview");
});

test("eikon generate models --json returns JSON array", async () => {
  const { code, stdout, stderr } = await runEikon(["generate", "models", "--json"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toContain("google/gemini-3-pro-image-preview");
});

test("eikon generate models --supports-ref filters for image input", async () => {
  const { code, stdout, stderr } = await runEikon(["generate", "models", "--supports-ref"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const lines = stdout.trim().split("\n");
  expect(lines).toContain("google/gemini-3-pro-image-preview");
  expect(lines).not.toContain("openai/gpt-5-image");
});

test("eikon generate models --details --json returns model details", async () => {
  const { code, stdout, stderr } = await runEikon(["generate", "models", "--details", "--json"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed[0]).toHaveProperty("id");
  expect(parsed[0]).toHaveProperty("inputModalities");
  expect(parsed[0]).toHaveProperty("outputModalities");
});

test("eikon edit models lists image-edit models", async () => {
  const { code, stdout, stderr } = await runEikon(["edit", "models"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const lines = stdout.trim().split("\n");
  expect(lines.length).toBeGreaterThan(0);
  expect(lines).toContain("stability/sdxl-edit");
});

test("eikon edit models --details prints concise metadata", async () => {
  const { code, stdout, stderr } = await runEikon(["edit", "models", "--details"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("ctx=");
  expect(stdout).toContain("in=");
  expect(stdout).toContain("out=");
});

test("eikon edit models --json returns JSON array", async () => {
  const { code, stdout, stderr } = await runEikon(["edit", "models", "--json"]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toContain("stability/sdxl-edit");
});

test("eikon save from stdin works", async () => {
  const bytes = await Bun.file(FIXTURE_PATH).arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/png;base64,${b64}`;
  const input = `Some prefix text "${dataUrl}" and suffix.`;
  const outPath = join(tmpdir(), `eikon-save-stdin-${Date.now()}.png`);

  const { code, stdout, stderr } = await runEikon(["save", "--out", outPath], {}, input);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain(`Path: ${outPath}`);
  expect(stdout).toContain("MIME: image/png");
  expect(stdout).toContain("Width: 3168");
  expect(stdout).toContain("Height: 2774");

  const savedBytes = await Bun.file(outPath).arrayBuffer();
  expect(savedBytes.byteLength).toBe(bytes.byteLength);
});

test("eikon save from --input works", async () => {
  const bytes = await Bun.file(FIXTURE_PATH).arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/png;base64,${b64}`;
  const inputPath = join(tmpdir(), `eikon-save-input-${Date.now()}.txt`);
  await Bun.write(inputPath, `DATA: ${dataUrl}`);
  const outPath = join(tmpdir(), `eikon-save-out-${Date.now()}.png`);

  const { code, stdout } = await runEikon(["save", "--input", inputPath, "--out", outPath]);

  expect(code).toBe(0);
  expect(stdout).toContain(`Path: ${outPath}`);
  const savedBytes = await Bun.file(outPath).arrayBuffer();
  expect(savedBytes.byteLength).toBe(bytes.byteLength);
});

test("eikon save --json works", async () => {
  const bytes = await Bun.file(FIXTURE_PATH).arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/png;base64,${b64}`;
  const outPath = join(tmpdir(), `eikon-save-json-${Date.now()}.png`);

  const { code, stdout } = await runEikon(["save", "--out", outPath, "--json"], {}, dataUrl);

  expect(code).toBe(0);
  const parsed = JSON.parse(stdout);
  expect(parsed.ok).toBe(true);
  expect(parsed.info.path).toBe(outPath);
  expect(parsed.info.width).toBe(3168);
  expect(parsed.info.height).toBe(2774);
});

test("eikon save fails if multiple data URLs found (exit 2)", async () => {
  const dataUrl = `data:image/png;base64,YmFzZTY0`;
  const input = `${dataUrl} and ${dataUrl}`;
  const outPath = join(tmpdir(), `eikon-save-fail-${Date.now()}.png`);

  const { code, stderr } = await runEikon(["save", "--out", outPath], {}, input);

  expect(code).toBe(2);
  expect(stderr).toContain("error: Expected exactly one image data URL in input, found 2");
});

test("eikon save fails if output exists and no --force (exit 5)", async () => {
  const bytes = await Bun.file(FIXTURE_PATH).arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/png;base64,${b64}`;
  const outPath = join(tmpdir(), `eikon-save-exists-${Date.now()}.png`);
  await Bun.write(outPath, "existing");

  const { code, stderr } = await runEikon(["save", "--out", outPath], {}, dataUrl);

  expect(code).toBe(5);
  expect(stderr).toContain("error: Output already exists");

  const { code: codeForce } = await runEikon(["save", "--out", outPath, "--force"], {}, dataUrl);
  expect(codeForce).toBe(0);
});
