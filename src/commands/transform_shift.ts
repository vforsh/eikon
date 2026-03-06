import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface TransformShiftOptions {
  out: string;
  x?: string;
  y?: string;
  bgColor?: string;
  wrap?: boolean;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

/**
 * Parse hex color string to RGBA components
 * Supports: #RGB, #RRGGBB, #RRGGBBAA
 */
function parseHexColor(color: string): { r: number; g: number; b: number; alpha: number } {
  const hex = color.startsWith("#") ? color.slice(1) : color;

  let r: number, g: number, b: number, alpha = 1;

  if (hex.length === 3) {
    const rHex = hex.charAt(0);
    const gHex = hex.charAt(1);
    const bHex = hex.charAt(2);
    r = parseInt(rHex + rHex, 16);
    g = parseInt(gHex + gHex, 16);
    b = parseInt(bHex + bHex, 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    alpha = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    throw new UsageError(`Invalid hex color: "${color}"`, [
      "Supported formats: #RGB, #RRGGBB, #RRGGBBAA",
    ]);
  }

  if ([r, g, b].some((v) => isNaN(v) || v < 0 || v > 255)) {
    throw new UsageError(`Invalid hex color: "${color}"`);
  }

  return { r, g, b, alpha };
}

/**
 * Get MIME type from output file extension
 */
function getMimeFromExtension(outPath: string): string {
  const ext = extname(outPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      throw new UsageError(`Unsupported output format: "${ext || "(no extension)"}"`, [
        "Supported formats: .png, .jpg, .jpeg, .webp",
      ]);
  }
}

/**
 * Parse a shift offset value (integer pixels, can be negative)
 */
function parseOffset(value: string, name: string): number {
  const trimmed = value.trim();
  const numStr = trimmed.endsWith("px") ? trimmed.slice(0, -2) : trimmed;
  const num = parseInt(numStr, 10);

  if (!Number.isInteger(num)) {
    throw new UsageError(`Invalid ${name}: "${value}" (expected integer)`);
  }

  return num;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  shift: { x: number; y: number };
}): string {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Shift: ${result.shift.x} ${result.shift.y}`,
  ].join("\n");
}

export async function transformShiftCommand(image: string, opts: TransformShiftOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon transform shift <image> --x 10 --y -20 --out shifted.png",
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  const dx = opts.x ? parseOffset(opts.x, "--x") : 0;
  const dy = opts.y ? parseOffset(opts.y, "--y") : 0;

  if (dx === 0 && dy === 0) {
    throw new UsageError("At least one non-zero shift offset is required", [
      "Use --x and/or --y to specify the shift.",
      "Example: eikon transform shift image.png --x 50 --y -30 --out shifted.png",
    ]);
  }

  let bgColor: { r: number; g: number; b: number; alpha: number } = { r: 0, g: 0, b: 0, alpha: 0 };
  if (opts.bgColor) {
    bgColor = parseHexColor(opts.bgColor);
  }

  const outPath = resolve(opts.out);
  const mime = getMimeFromExtension(outPath);
  const outFile = Bun.file(outPath);

  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, [
      "Pass --force to overwrite.",
    ]);
  }

  const originalInfo = await getImageInfo(imagePath);
  const { width, height } = originalInfo;

  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  let pipeline;

  if (opts.wrap) {
    // Wrap mode: content that goes off one edge appears on the opposite edge
    // Normalize offsets to positive values within image bounds
    const nx = ((dx % width) + width) % width;
    const ny = ((dy % height) + height) % height;

    // Use sharp to tile and extract
    // Strategy: extend the image by tiling, then extract the shifted region
    const base = sharp(inputBuffer);
    const baseBuffer = await base.raw().toBuffer();
    const channels = originalInfo.channels;

    // Create a new buffer with shifted content
    const newBuffer = Buffer.alloc(width * height * channels);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        // Source pixel for this destination pixel
        const srcCol = (col - nx + width) % width;
        const srcRow = (row - ny + height) % height;
        const srcIdx = (srcRow * width + srcCol) * channels;
        const dstIdx = (row * width + col) * channels;
        for (let c = 0; c < channels; c++) {
          newBuffer[dstIdx + c] = baseBuffer[srcIdx + c];
        }
      }
    }

    pipeline = sharp(newBuffer, {
      raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
    });
  } else {
    // Default mode: shift content, fill vacated space with bgColor
    // Create a blank canvas of the same size, then composite the original at the offset
    const canvas = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: bgColor,
      },
    });

    const canvasBuffer = await canvas.png().toBuffer();

    pipeline = sharp(canvasBuffer).composite([
      { input: inputBuffer, left: dx, top: dy },
    ]);
  }

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
    const flattenBg = opts.bgColor ? bgColor : { r: 255, g: 255, b: 255 };
    outputBytes = await pipeline
      .flatten({ background: { r: flattenBg.r, g: flattenBg.g, b: flattenBg.b } })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  } else {
    outputBytes = await pipeline.toBuffer();
  }

  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  const result = {
    ok: true,
    command: "transform shift",
    outPath,
    mime,
    bytes: outputBytes.length,
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    shift: { x: dx, y: dy },
    wrap: opts.wrap || false,
    bgColor: opts.bgColor || null,
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
