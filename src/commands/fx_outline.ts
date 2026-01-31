import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface FxOutlineOptions {
  out: string;
  color?: string;
  width?: string;
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

export async function fxOutlineCommand(image: string, opts: FxOutlineOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      'Usage: eikon fx outline <image> --out outlined.png',
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Parse options
  const outlineColor = opts.color ? parseHexColor(opts.color) : { r: 0, g: 0, b: 0, alpha: 1 };
  const outlineWidth = opts.width !== undefined ? parseInt(opts.width, 10) : 2;

  if (isNaN(outlineWidth) || outlineWidth < 1) {
    throw new UsageError(`Invalid --width: "${opts.width}" (expected positive integer)`);
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

  const srcW = originalInfo.width;
  const srcH = originalInfo.height;

  // Step 1: Extract alpha channel
  const alphaBuffer: Buffer = await sharp(inputBuffer)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();

  // Step 2: Expand canvas by outlineWidth on all sides
  const expandedW = srcW + outlineWidth * 2;
  const expandedH = srcH + outlineWidth * 2;

  // Create padded alpha (original alpha centered in expanded canvas)
  const paddedAlpha = new Uint8Array(expandedW * expandedH);
  const srcAlpha = new Uint8Array(alphaBuffer);
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      paddedAlpha[(y + outlineWidth) * expandedW + (x + outlineWidth)] = srcAlpha[y * srcW + x];
    }
  }

  // Step 3: Dilate alpha mask by outlineWidth using circular structuring element
  const dilated = new Uint8Array(expandedW * expandedH);
  const r2 = outlineWidth * outlineWidth;
  for (let y = 0; y < expandedH; y++) {
    for (let x = 0; x < expandedW; x++) {
      let maxVal = 0;
      for (let sy = -outlineWidth; sy <= outlineWidth; sy++) {
        for (let sx = -outlineWidth; sx <= outlineWidth; sx++) {
          if (sx * sx + sy * sy > r2) continue;
          const nx = x + sx;
          const ny = y + sy;
          if (nx >= 0 && nx < expandedW && ny >= 0 && ny < expandedH) {
            maxVal = Math.max(maxVal, paddedAlpha[ny * expandedW + nx]);
          }
        }
      }
      dilated[y * expandedW + x] = maxVal;
    }
  }

  // Step 4: Subtract original padded alpha from dilated to get outline-only ring
  const outlineAlpha = new Uint8Array(expandedW * expandedH);
  for (let i = 0; i < expandedW * expandedH; i++) {
    const diff = dilated[i] - paddedAlpha[i];
    outlineAlpha[i] = diff > 0 ? diff : 0;
  }

  // Step 5: Assemble RGBA outline layer (solid color + outline alpha)
  const outlineRgba = Buffer.alloc(expandedW * expandedH * 4);
  for (let i = 0; i < expandedW * expandedH; i++) {
    outlineRgba[i * 4 + 0] = outlineColor.r;
    outlineRgba[i * 4 + 1] = outlineColor.g;
    outlineRgba[i * 4 + 2] = outlineColor.b;
    outlineRgba[i * 4 + 3] = outlineAlpha[i];
  }

  const outlineLayer: Buffer = await sharp(outlineRgba, {
    raw: { width: expandedW, height: expandedH, channels: 4 },
  })
    .png()
    .toBuffer();

  // Step 6: Create transparent canvas, composite outline then original on top (centered)
  let pipeline = sharp({
    create: {
      width: expandedW,
      height: expandedH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    { input: outlineLayer, left: 0, top: 0 },
    { input: inputBuffer, left: outlineWidth, top: outlineWidth },
  ]);

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
  const result = {
    ok: true,
    outPath,
    mime,
    bytes: outputBytes.length,
    width: expandedW,
    height: expandedH,
    originalWidth: originalInfo.width,
    originalHeight: originalInfo.height,
    outline: {
      color: opts.color || "#000000",
      width: outlineWidth,
    },
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
