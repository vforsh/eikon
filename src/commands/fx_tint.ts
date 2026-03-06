import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface FxTintOptions {
  out: string;
  color: string;
  amount?: string;
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

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
}): string {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
  ].join("\n");
}

export async function fxTintCommand(image: string, opts: FxTintOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      'Usage: eikon fx tint <image> --color "#ff0000" --out tinted.png',
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Parse options
  if (!opts.color) {
    throw new UsageError("Missing required --color option", [
      'Usage: eikon fx tint <image> --color "#ff0000" --out tinted.png',
    ]);
  }
  const tintColor = parseHexColor(opts.color);
  const amount = opts.amount !== undefined ? parseFloat(opts.amount) : 1.0;

  if (isNaN(amount) || amount < 0 || amount > 1) {
    throw new UsageError(`Invalid --amount: "${opts.amount}" (expected 0..1)`);
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

  const originalInfo = await getImageInfo(imagePath);
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  // Step 1: Get raw RGBA pixels
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const pixelCount = info.width * info.height;
  const result = new Uint8Array(pixelCount * 4);

  // Step 2: For each pixel, compute luminance-based tint and blend
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const r = pixels[off] ?? 0;
    const g = pixels[off + 1] ?? 0;
    const b = pixels[off + 2] ?? 0;
    const a = pixels[off + 3] ?? 0;

    // Perceived luminance (ITU-R BT.601)
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Tinted pixel: tint color scaled by luminance
    const tR = Math.round(tintColor.r * lum);
    const tG = Math.round(tintColor.g * lum);
    const tB = Math.round(tintColor.b * lum);

    // Blend original and tinted by amount
    result[off] = Math.round(r * (1 - amount) + tR * amount);
    result[off + 1] = Math.round(g * (1 - amount) + tG * amount);
    result[off + 2] = Math.round(b * (1 - amount) + tB * amount);
    result[off + 3] = a; // preserve alpha
  }

  // Step 3: Build image from raw RGBA buffer
  let pipeline = sharp(Buffer.from(result), {
    raw: { width: info.width, height: info.height, channels: 4 },
  });

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
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
  const outputResult = {
    ok: true,
    outPath,
    mime,
    bytes: outputBytes.length,
    width: info.width,
    height: info.height,
    tint: {
      color: opts.color,
      amount,
    },
  };

  if (opts.json) {
    renderJson(outputResult);
  } else if (opts.plain) {
    renderPlain(formatPlain(outputResult));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(outputResult));
  }
}
