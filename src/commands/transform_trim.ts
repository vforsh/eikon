import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface TransformTrimOptions {
  out: string;
  threshold?: string;
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
  padding?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
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
 * Parse threshold value (0-255)
 */
function parseThreshold(value: string): number {
  const num = parseInt(value, 10);
  if (!Number.isInteger(num) || num < 0 || num > 255) {
    throw new UsageError(`Invalid --threshold: "${value}" (expected integer 0-255)`);
  }
  return num;
}

/**
 * Parse padding value (non-negative integer)
 */
function parsePadding(value: string): number {
  const trimmed = value.trim();
  const numStr = trimmed.endsWith("px") ? trimmed.slice(0, -2) : trimmed;
  const num = parseInt(numStr, 10);

  if (!Number.isInteger(num) || num < 0) {
    throw new UsageError(`Invalid --padding: "${value}" (expected non-negative integer)`);
  }

  return num;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  trimmed: { top: number; right: number; bottom: number; left: number };
}): string {
  const { trimmed } = result;
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Original: ${result.originalWidth}x${result.originalHeight}`,
    `Trimmed: ${trimmed.top} ${trimmed.right} ${trimmed.bottom} ${trimmed.left}`,
  ].join("\n");
}

/**
 * Find trim bounds by scanning for transparent pixels
 */
async function findTrimBounds(
  sharp: any,
  inputBuffer: Buffer,
  width: number,
  height: number,
  threshold: number,
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean }
): Promise<{ top: number; right: number; bottom: number; left: number }> {
  // Extract raw RGBA pixel data
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels; // Should be 4 (RGBA)
  const rowBytes = width * channels;

  let trimTop = 0;
  let trimBottom = 0;
  let trimLeft = 0;
  let trimRight = 0;

  // Helper to check if a pixel is transparent (alpha <= threshold)
  const isTransparent = (x: number, y: number): boolean => {
    const offset = y * rowBytes + x * channels + 3; // +3 for alpha channel
    return data[offset] <= threshold;
  };

  // Helper to check if entire row is transparent
  const isRowTransparent = (y: number): boolean => {
    for (let x = 0; x < width; x++) {
      if (!isTransparent(x, y)) return false;
    }
    return true;
  };

  // Helper to check if entire column is transparent
  const isColTransparent = (x: number, startY: number, endY: number): boolean => {
    for (let y = startY; y < endY; y++) {
      if (!isTransparent(x, y)) return false;
    }
    return true;
  };

  // Find top trim
  if (sides.top) {
    for (let y = 0; y < height; y++) {
      if (isRowTransparent(y)) {
        trimTop++;
      } else {
        break;
      }
    }
  }

  // Find bottom trim
  if (sides.bottom) {
    for (let y = height - 1; y >= trimTop; y--) {
      if (isRowTransparent(y)) {
        trimBottom++;
      } else {
        break;
      }
    }
  }

  // Calculate vertical bounds for column scanning
  const startY = trimTop;
  const endY = height - trimBottom;

  // Find left trim (only scan non-trimmed rows)
  if (sides.left && endY > startY) {
    for (let x = 0; x < width; x++) {
      if (isColTransparent(x, startY, endY)) {
        trimLeft++;
      } else {
        break;
      }
    }
  }

  // Find right trim (only scan non-trimmed rows)
  if (sides.right && endY > startY) {
    for (let x = width - 1; x >= trimLeft; x--) {
      if (isColTransparent(x, startY, endY)) {
        trimRight++;
      } else {
        break;
      }
    }
  }

  return { top: trimTop, right: trimRight, bottom: trimBottom, left: trimLeft };
}

export async function transformTrimCommand(image: string, opts: TransformTrimOptions) {
  // Validate input
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon transform trim <image> --out trimmed.png",
    ]);
  }

  // Validate input file exists
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Parse threshold (default: 0 = only fully transparent)
  const threshold = opts.threshold ? parseThreshold(opts.threshold) : 0;

  // Determine which sides to trim (default: all)
  const anySideSpecified = opts.top || opts.right || opts.bottom || opts.left;
  const sides = {
    top: anySideSpecified ? !!opts.top : true,
    right: anySideSpecified ? !!opts.right : true,
    bottom: anySideSpecified ? !!opts.bottom : true,
    left: anySideSpecified ? !!opts.left : true,
  };

  // Parse padding (default: 0)
  const padding = opts.padding ? parsePadding(opts.padding) : 0;

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

  // Load sharp and process
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  // Find trim bounds
  const trimBounds = await findTrimBounds(
    sharp,
    inputBuffer,
    originalInfo.width,
    originalInfo.height,
    threshold,
    sides
  );

  // Calculate crop region
  let cropLeft = trimBounds.left;
  let cropTop = trimBounds.top;
  let cropWidth = originalInfo.width - trimBounds.left - trimBounds.right;
  let cropHeight = originalInfo.height - trimBounds.top - trimBounds.bottom;

  // Handle edge case: entire image would be trimmed
  if (cropWidth <= 0 || cropHeight <= 0) {
    // Return a 1x1 transparent pixel
    cropLeft = 0;
    cropTop = 0;
    cropWidth = 1;
    cropHeight = 1;
    // Reset trim bounds for accurate reporting
    trimBounds.top = originalInfo.height > 0 ? originalInfo.height - 1 : 0;
    trimBounds.bottom = 0;
    trimBounds.left = originalInfo.width > 0 ? originalInfo.width - 1 : 0;
    trimBounds.right = 0;
  }

  // Build sharp pipeline
  let pipeline = sharp(inputBuffer).extract({
    left: cropLeft,
    top: cropTop,
    width: cropWidth,
    height: cropHeight,
  });

  // Add padding back if requested
  if (padding > 0) {
    pipeline = pipeline.extend({
      top: sides.top ? padding : 0,
      right: sides.right ? padding : 0,
      bottom: sides.bottom ? padding : 0,
      left: sides.left ? padding : 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  // Calculate final dimensions
  const finalWidth = cropWidth + (sides.left ? padding : 0) + (sides.right ? padding : 0);
  const finalHeight = cropHeight + (sides.top ? padding : 0) + (sides.bottom ? padding : 0);

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
    // JPEG doesn't support alpha, flatten with white background
    outputBytes = await pipeline
      .flatten({ background: { r: 255, g: 255, b: 255 } })
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
    width: finalWidth,
    height: finalHeight,
    originalWidth: originalInfo.width,
    originalHeight: originalInfo.height,
    trimmed: trimBounds,
    threshold,
    padding,
    sides,
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
