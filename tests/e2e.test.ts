import { test, expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MOCK_RESPONSE = "EIKON_E2E_MOCK_RESPONSE";
const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "e2e-app.png");

async function runEikon(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn({
    cmd: ["./index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      OPENROUTER_API_KEY: "test-key",
      EIKON_MOCK_OPENROUTER: "1",
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

test("eikon runs with preset and prints text", async () => {
  const { code, stdout, stderr } = await runEikon([
    FIXTURE_PATH,
    "--preset",
    "web-ui",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe(MOCK_RESPONSE);
});

test("eikon --json returns JSON", async () => {
  const { code, stdout, stderr } = await runEikon([
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--json",
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);

  const parsed = JSON.parse(stdout);
  expect(parsed).toEqual({ text: MOCK_RESPONSE });
});

test("eikon --out writes to file", async () => {
  const outPath = join(tmpdir(), `eikon-e2e-${Date.now()}.txt`);
  const { code, stdout, stderr } = await runEikon([
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--out",
    outPath,
  ]);

  expect(stderr.trim()).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("");

  const text = await Bun.file(outPath).text();
  expect(text).toBe(MOCK_RESPONSE);
});

test("eikon --downsize resizes image to default max", async () => {
  const { code, stdout } = await runEikon(
    [FIXTURE_PATH, "--preset", "web-ui", "--downsize"],
    { EIKON_TEST_IMAGE_INFO: "1" },
  );

  expect(code).toBe(0);
  // Original is 3168x2774. Default max is 2048.
  // fit: inside means it should be 2048x1793 (approx)
  expect(stdout).toContain("w:2048");
  expect(stdout).toContain("h:1793");
});

test("eikon --max-width 1000 resizes width", async () => {
  const { code, stdout } = await runEikon(
    [FIXTURE_PATH, "--preset", "web-ui", "--max-width", "1000"],
    { EIKON_TEST_IMAGE_INFO: "1" },
  );

  expect(code).toBe(0);
  expect(stdout).toContain("w:1000");
});

test("eikon --max-width x0.5 resizes by scale", async () => {
  const { code, stdout } = await runEikon(
    [FIXTURE_PATH, "--preset", "web-ui", "--max-width", "x0.5"],
    { EIKON_TEST_IMAGE_INFO: "1" },
  );

  expect(code).toBe(0);
  // 3168 * 0.5 = 1584
  expect(stdout).toContain("w:1584");
});

test("eikon handles invalid resize spec", async () => {
  const { code, stderr } = await runEikon([
    FIXTURE_PATH,
    "--preset",
    "web-ui",
    "--max-width",
    "abc",
  ]);

  expect(code).toBe(2);
  expect(stderr).toContain("Invalid --max-width");
});
