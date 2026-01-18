import { test, expect } from "bun:test";
import { resolveResizeTarget } from "../src/resize";
import { UsageError } from "../src/errors";

const original = { width: 1000, height: 500 };

test("resolveResizeTarget defaults to 2x", () => {
  const result = resolveResizeTarget(original, {});
  expect(result.width).toBe(2000);
  expect(result.height).toBe(1000);
  expect(result.scale).toBe(2);
});

test("resolveResizeTarget supports scale", () => {
  const result = resolveResizeTarget(original, { scale: "2.5" });
  expect(result.width).toBe(2500);
  expect(result.height).toBe(1250);
});

test("resolveResizeTarget supports width", () => {
  const result = resolveResizeTarget(original, { width: 3000 });
  expect(result.width).toBe(3000);
  expect(result.height).toBe(1500);
});

test("resolveResizeTarget supports height", () => {
  const result = resolveResizeTarget(original, { height: 1200 });
  expect(result.width).toBe(2400);
  expect(result.height).toBe(1200);
});

test("resolveResizeTarget rejects multiple options", () => {
  expect(() => resolveResizeTarget(original, { scale: 2, width: 2000 })).toThrow(UsageError);
});

test("resolveResizeTarget rejects scale <= 1", () => {
  expect(() => resolveResizeTarget(original, { scale: 1 })).toThrow(UsageError);
});

test("resolveResizeTarget rejects downscale by width", () => {
  expect(() => resolveResizeTarget(original, { width: 900 })).toThrow(UsageError);
});

test("resolveResizeTarget rejects downscale by height", () => {
  expect(() => resolveResizeTarget(original, { height: 400 })).toThrow(UsageError);
});
