import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface TransformCropOptions {
  out: string;
  left?: string;
  top?: string;
  width?: string;
  height?: string;
  right?: string;
  bottom?: string;
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
 * Parse a dimension value that can be pixels or percentage
 * Examples: "100", "100px", "50%"
 */
function parseDimension(value: string, relativeTo: number, name: string): number {
  const trimmed = value.trim();

  if (trimmed.endsWith("%")) {
    const percent = parseFloat(trimmed.slice(0, -1));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new UsageError(`Invalid ${name}: "${value}" (expected 0-100%)`);
    }
    return Math.round((percent / 100) * relativeTo);
  }

  // Remove optional "px" suffix
  const numStr = trimmed.endsWith("px") ? trimmed.slice(0, -2) : trimmed;
  const num = parseInt(numStr, 10);

  if (!Number.isInteger(num) || num < 0) {
    throw new UsageError(`Invalid ${name}: "${value}" (expected positive integer or percentage)`);
  }

  return num;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  cropRegion: { left: number; top: number; width: number; height: number };
}): string {
  const { cropRegion } = result;
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Crop: ${cropRegion.left},${cropRegion.top} ${cropRegion.width}x${cropRegion.height}`,
  ].join("\n");
}

export async function transformCropCommand(image: string, opts: TransformCropOptions) {
  // Validate input
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon transform crop <image> --left 10 --top 10 --width 100 --height 100 --out cropped.png",
    ]);
  }

  // Validate input file exists
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Get original image info
  const originalInfo = await getImageInfo(imagePath);
  const imgWidth = originalInfo.width;
  const imgHeight = originalInfo.height;

  // Parse crop region
  // Support two modes:
  // 1. left/top/width/height - explicit region
  // 2. left/top/right/bottom - infer width/height from edges

  const left = opts.left ? parseDimension(opts.left, imgWidth, "--left") : 0;
  const top = opts.top ? parseDimension(opts.top, imgHeight, "--top") : 0;

  let cropWidth: number;
  let cropHeight: number;

  if (opts.width) {
    cropWidth = parseDimension(opts.width, imgWidth, "--width");
  } else if (opts.right) {
    const right = parseDimension(opts.right, imgWidth, "--right");
    cropWidth = right - left;
  } else {
    cropWidth = imgWidth - left;
  }

  if (opts.height) {
    cropHeight = parseDimension(opts.height, imgHeight, "--height");
  } else if (opts.bottom) {
    const bottom = parseDimension(opts.bottom, imgHeight, "--bottom");
    cropHeight = bottom - top;
  } else {
    cropHeight = imgHeight - top;
  }

  // Validate crop region
  if (cropWidth <= 0) {
    throw new UsageError(`Invalid crop width: ${cropWidth} (must be positive)`);
  }
  if (cropHeight <= 0) {
    throw new UsageError(`Invalid crop height: ${cropHeight} (must be positive)`);
  }
  if (left < 0 || left >= imgWidth) {
    throw new UsageError(`Invalid crop left: ${left} (must be 0 to ${imgWidth - 1})`);
  }
  if (top < 0 || top >= imgHeight) {
    throw new UsageError(`Invalid crop top: ${top} (must be 0 to ${imgHeight - 1})`);
  }
  if (left + cropWidth > imgWidth) {
    throw new UsageError(`Crop region exceeds image width: ${left} + ${cropWidth} > ${imgWidth}`);
  }
  if (top + cropHeight > imgHeight) {
    throw new UsageError(`Crop region exceeds image height: ${top} + ${cropHeight} > ${imgHeight}`);
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

  // Load sharp and process
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  let pipeline = sharp(inputBuffer).extract({
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  });

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
    outputBytes = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
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
    width: cropWidth,
    height: cropHeight,
    originalWidth: imgWidth,
    originalHeight: imgHeight,
    cropRegion: {
      left,
      top,
      width: cropWidth,
      height: cropHeight,
    },
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
