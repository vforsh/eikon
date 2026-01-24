import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface TransformPadOptions {
  out: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  all?: string;
  bgColor?: string;
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
 * Parse a padding value (pixels only, no percentage)
 */
function parsePadding(value: string, name: string): number {
  const trimmed = value.trim();
  // Remove optional "px" suffix
  const numStr = trimmed.endsWith("px") ? trimmed.slice(0, -2) : trimmed;
  const num = parseInt(numStr, 10);

  if (!Number.isInteger(num) || num < 0) {
    throw new UsageError(`Invalid ${name}: "${value}" (expected non-negative integer)`);
  }

  return num;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}): string {
  const { padding } = result;
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Padding: ${padding.top} ${padding.right} ${padding.bottom} ${padding.left}`,
  ].join("\n");
}

export async function transformPadCommand(image: string, opts: TransformPadOptions) {
  // Validate input
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon transform pad <image> --all 20 --out padded.png",
    ]);
  }

  // Validate input file exists
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Parse padding values
  // --all sets a default for all sides, individual sides can override
  const allPadding = opts.all ? parsePadding(opts.all, "--all") : 0;

  const topPad = opts.top ? parsePadding(opts.top, "--top") : allPadding;
  const rightPad = opts.right ? parsePadding(opts.right, "--right") : allPadding;
  const bottomPad = opts.bottom ? parsePadding(opts.bottom, "--bottom") : allPadding;
  const leftPad = opts.left ? parsePadding(opts.left, "--left") : allPadding;

  // Validate at least some padding is specified
  if (topPad === 0 && rightPad === 0 && bottomPad === 0 && leftPad === 0) {
    throw new UsageError("At least some padding is required", [
      "Use --all, --top, --right, --bottom, or --left to specify padding.",
      "Example: eikon transform pad image.png --all 20 --out padded.png",
    ]);
  }

  // Parse background color (default: transparent)
  let bgColor: { r: number; g: number; b: number; alpha: number } = { r: 0, g: 0, b: 0, alpha: 0 };
  if (opts.bgColor) {
    bgColor = parseHexColor(opts.bgColor);
  }

  // Validate and prepare output path
  const outPath = resolve(opts.out);
  const mime = getMimeFromExtension(outPath);
  const outFile = Bun.file(outPath);

  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, [
      "Pass --force to overwrite.",
    ]);
  }

  // Get original image info
  const originalInfo = await getImageInfo(imagePath);

  // Calculate new dimensions
  const newWidth = originalInfo.width + leftPad + rightPad;
  const newHeight = originalInfo.height + topPad + bottomPad;

  // Load sharp and process
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  let pipeline = sharp(inputBuffer).extend({
    top: topPad,
    right: rightPad,
    bottom: bottomPad,
    left: leftPad,
    background: bgColor,
  });

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
    // JPEG doesn't support alpha, flatten with background
    const flattenBg = opts.bgColor ? bgColor : { r: 255, g: 255, b: 255 };
    outputBytes = await pipeline
      .flatten({ background: { r: flattenBg.r, g: flattenBg.g, b: flattenBg.b } })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  } else {
    outputBytes = await pipeline.toBuffer();
  }

  // Write output
  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  // Build result
  const result = {
    ok: true,
    outPath,
    mime,
    bytes: outputBytes.length,
    width: newWidth,
    height: newHeight,
    originalWidth: originalInfo.width,
    originalHeight: originalInfo.height,
    padding: {
      top: topPad,
      right: rightPad,
      bottom: bottomPad,
      left: leftPad,
    },
    bgColor: opts.bgColor || null,
  };

  // Output handling
  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
