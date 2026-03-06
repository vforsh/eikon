import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface FxGlowOptions {
  out: string;
  color?: string;
  opacity?: string;
  blur?: string;
  spread?: string;
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

export async function fxGlowCommand(image: string, opts: FxGlowOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      'Usage: eikon fx glow <image> --out glow.png',
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Parse options
  const glowColor = opts.color ? parseHexColor(opts.color) : { r: 255, g: 255, b: 255, alpha: 1 };
  const opacity = opts.opacity !== undefined ? parseFloat(opts.opacity) : 0.8;
  const blurRadius = opts.blur !== undefined ? parseFloat(opts.blur) : 10;
  const spread = opts.spread !== undefined ? parseInt(opts.spread, 10) : 0;

  if (isNaN(opacity) || opacity < 0 || opacity > 1) {
    throw new UsageError(`Invalid --opacity: "${opts.opacity}" (expected 0..1)`);
  }
  if (isNaN(blurRadius) || blurRadius < 0) {
    throw new UsageError(`Invalid --blur: "${opts.blur}" (expected non-negative number)`);
  }
  if (isNaN(spread) || spread < 0) {
    throw new UsageError(`Invalid --spread: "${opts.spread}" (expected non-negative integer)`);
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

  // Calculate symmetric canvas expansion for glow (no offset)
  const blurExpand = Math.ceil(blurRadius * 3); // 3-sigma covers ~99.7%
  const totalExpand = blurExpand + spread;

  const canvasWidth = originalInfo.width + totalExpand * 2;
  const canvasHeight = originalInfo.height + totalExpand * 2;

  // Step 1: Extract alpha channel from source image
  let alphaBuffer: Buffer = await sharp(inputBuffer)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer();

  const srcW = originalInfo.width;
  const srcH = originalInfo.height;

  // Step 2: Apply spread (dilate the alpha mask)
  if (spread > 0) {
    const dilated = new Uint8Array(srcW * srcH);
    const src = new Uint8Array(alphaBuffer);
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        let maxVal = 0;
        for (let sy = -spread; sy <= spread; sy++) {
          for (let sx = -spread; sx <= spread; sx++) {
            if (sx * sx + sy * sy > spread * spread) continue;
            const nx = x + sx;
            const ny = y + sy;
            if (nx >= 0 && nx < srcW && ny >= 0 && ny < srcH) {
              maxVal = Math.max(maxVal, src[ny * srcW + nx] ?? 0);
            }
          }
        }
        dilated[y * srcW + x] = maxVal;
      }
    }
    alphaBuffer = Buffer.from(dilated);
  }

  // Step 3: Blur alpha if needed
  let processedAlpha: Buffer;

  if (blurRadius > 0) {
    const sigma = Math.max(0.3, blurRadius);
    // Sharp may expand 1-channel greyscale to 3 channels on raw output,
    // so we use resolveWithObject to get actual channel count
    const { data, info } = await sharp(alphaBuffer, {
      raw: { width: srcW, height: srcH, channels: 1 },
    })
      .blur(sigma)
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels === 1) {
      processedAlpha = data;
    } else {
      // Extract first channel only
      processedAlpha = Buffer.alloc(srcW * srcH);
      for (let i = 0; i < srcW * srcH; i++) {
        processedAlpha[i] = data[i * info.channels] ?? 0;
      }
    }
  } else {
    // No blur — use alpha buffer directly
    processedAlpha = Buffer.from(alphaBuffer);
  }

  // Step 4: Scale alpha by opacity
  if (opacity < 1) {
    const pixels = new Uint8Array(processedAlpha);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = Math.round((pixels[i] ?? 0) * opacity);
    }
    processedAlpha = Buffer.from(pixels);
  }

  // Step 5: Assemble RGBA glow layer (solid color + processed alpha)
  const glowRgba = Buffer.alloc(srcW * srcH * 4);
  const alphaPixels = new Uint8Array(processedAlpha);
  for (let i = 0; i < srcW * srcH; i++) {
    glowRgba[i * 4 + 0] = glowColor.r;
    glowRgba[i * 4 + 1] = glowColor.g;
    glowRgba[i * 4 + 2] = glowColor.b;
    glowRgba[i * 4 + 3] = alphaPixels[i] ?? 0;
  }

  const glowLayer: Buffer = await sharp(glowRgba, {
    raw: { width: srcW, height: srcH, channels: 4 },
  })
    .png()
    .toBuffer();

  // Step 6: Create transparent canvas and composite glow + original (both centered)
  const origLeft = totalExpand;
  const origTop = totalExpand;

  let pipeline = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    { input: glowLayer, left: origLeft, top: origTop },
    { input: inputBuffer, left: origLeft, top: origTop },
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
    command: "fx glow",
    outPath,
    mime,
    bytes: outputBytes.length,
    width: canvasWidth,
    height: canvasHeight,
    originalWidth: originalInfo.width,
    originalHeight: originalInfo.height,
    glow: {
      color: opts.color || "#ffffff",
      opacity,
      blur: blurRadius,
      spread,
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
