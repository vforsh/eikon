import { UsageError } from "./errors";

export interface ResizeOptions {
  scale?: string | number;
  width?: string | number;
  height?: string | number;
}

export interface ResizeResult {
  width: number;
  height: number;
  scale: number;
}

export function resolveResizeTarget(
  original: { width: number; height: number },
  opts: ResizeOptions
): ResizeResult {
  const scaleProvided = opts.scale !== undefined;
  const widthProvided = opts.width !== undefined;
  const heightProvided = opts.height !== undefined;
  const providedCount = Number(scaleProvided) + Number(widthProvided) + Number(heightProvided);

  if (providedCount > 1) {
    throw new UsageError("Provide only one of: --scale, --width, --height.");
  }

  if (scaleProvided) {
    const scale = typeof opts.scale === "string" ? Number(opts.scale) : opts.scale!;
    if (!Number.isFinite(scale) || scale <= 1) {
      throw new UsageError("Invalid --scale. Expected a number > 1.");
    }
    const width = Math.round(original.width * scale);
    const height = Math.round(original.height * scale);
    if (width < original.width || height < original.height) {
      throw new UsageError("Downscale not allowed. Target dimensions must be >= original.");
    }
    return { width, height, scale };
  }

  if (widthProvided) {
    const width = typeof opts.width === "string" ? Number(opts.width) : opts.width!;
    if (!Number.isInteger(width) || width <= 0) {
      throw new UsageError("Invalid --width. Expected a positive integer.");
    }
    if (width < original.width) {
      throw new UsageError("Downscale not allowed. Target dimensions must be >= original.");
    }
    const scale = width / original.width;
    const height = Math.round(original.height * scale);
    return { width, height, scale };
  }

  if (heightProvided) {
    const height = typeof opts.height === "string" ? Number(opts.height) : opts.height!;
    if (!Number.isInteger(height) || height <= 0) {
      throw new UsageError("Invalid --height. Expected a positive integer.");
    }
    if (height < original.height) {
      throw new UsageError("Downscale not allowed. Target dimensions must be >= original.");
    }
    const scale = height / original.height;
    const width = Math.round(original.width * scale);
    return { width, height, scale };
  }

  const scale = 2;
  return {
    width: Math.round(original.width * scale),
    height: Math.round(original.height * scale),
    scale,
  };
}
