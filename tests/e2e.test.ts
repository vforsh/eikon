import { test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOCK_RESPONSE = "EIKON_E2E_MOCK_RESPONSE";
const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "e2e-app.png");
const TEST_CONFIG_PATH = join(tmpdir(), `eikon-test-config-${Date.now()}.toml`);

async function runEikon(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn({
    cmd: ["./index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENROUTER_API_KEY: "test-key",
      EIKON_MOCK_OPENROUTER: "1",
      EIKON_CONFIG_PATH: TEST_CONFIG_PATH,
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
