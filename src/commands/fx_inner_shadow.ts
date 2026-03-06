import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface FxInnerShadowOptions {
  out: string;
  color?: string;
  opacity?: string;
  blur?: string;
  dx?: string;
  dy?: string;
  spread?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

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

function erodeAlphaMask(alphaBuffer: Buffer, width: number, height: number, radius: number): Buffer {
  if (radius <= 0) {
    return Buffer.from(alphaBuffer);
  }

  const src = new Uint8Array(alphaBuffer);
  const eroded = new Uint8Array(width * height);
  const radiusSquared = radius * radius;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      let touchedOutside = false;

      for (let sy = -radius; sy <= radius && minVal > 0; sy++) {
        for (let sx = -radius; sx <= radius && minVal > 0; sx++) {
          if (sx * sx + sy * sy > radiusSquared) continue;

          const nx = x + sx;
          const ny = y + sy;

          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            touchedOutside = true;
            minVal = 0;
            break;
          }

          minVal = Math.min(minVal, src[ny * width + nx] ?? 0);
        }
      }

      eroded[y * width + x] = touchedOutside ? 0 : minVal;
    }
  }

  return Buffer.from(eroded);
}

async function blurSingleChannel(
  sharp: Awaited<ReturnType<typeof loadSharp>>,
  alphaBuffer: Buffer,
  width: number,
  height: number,
  blurRadius: number,
): Promise<Buffer> {
  if (blurRadius <= 0) {
    return Buffer.from(alphaBuffer);
  }

  const sigma = Math.max(0.3, blurRadius);
  const { data, info } = await sharp(alphaBuffer, {
    raw: { width, height, channels: 1 },
  })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels === 1) {
    return data;
  }

  const singleChannel = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    singleChannel[i] = data[i * info.channels] ?? 0;
  }
  return singleChannel;
}

export async function fxInnerShadowCommand(image: string, opts: FxInnerShadowOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      'Usage: eikon fx inner-shadow <image> --out inset.png',
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  const shadowColor = opts.color ? parseHexColor(opts.color) : { r: 0, g: 0, b: 0, alpha: 1 };
  const opacity = opts.opacity !== undefined ? parseFloat(opts.opacity) : 0.5;
  const blurRadius = opts.blur !== undefined ? parseFloat(opts.blur) : 10;
  const dx = opts.dx !== undefined ? parseInt(opts.dx, 10) : 0;
  const dy = opts.dy !== undefined ? parseInt(opts.dy, 10) : 4;
  const spread = opts.spread !== undefined ? parseInt(opts.spread, 10) : 0;

  if (isNaN(opacity) || opacity < 0 || opacity > 1) {
    throw new UsageError(`Invalid --opacity: "${opts.opacity}" (expected 0..1)`);
  }
  if (isNaN(blurRadius) || blurRadius < 0) {
    throw new UsageError(`Invalid --blur: "${opts.blur}" (expected non-negative number)`);
  }
  if (isNaN(dx)) {
    throw new UsageError(`Invalid --dx: "${opts.dx}" (expected integer)`);
  }
  if (isNaN(dy)) {
    throw new UsageError(`Invalid --dy: "${opts.dy}" (expected integer)`);
  }
  if (isNaN(spread) || spread < 0) {
    throw new UsageError(`Invalid --spread: "${opts.spread}" (expected non-negative integer)`);
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
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());
  const { data: rawInput, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = originalInfo.width;
  const height = originalInfo.height;
  const channels = info.channels ?? 4;

  const originalRgba = Buffer.alloc(width * height * 4);
  const originalAlpha = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    const srcIndex = i * channels;
    const dstIndex = i * 4;
    originalRgba[dstIndex + 0] = rawInput[srcIndex + 0] ?? 0;
    originalRgba[dstIndex + 1] = rawInput[srcIndex + 1] ?? 0;
    originalRgba[dstIndex + 2] = rawInput[srcIndex + 2] ?? 0;
    originalRgba[dstIndex + 3] = rawInput[srcIndex + 3] ?? 0;
    originalAlpha[i] = rawInput[srcIndex + 3] ?? 0;
  }

  const erodedAlpha = erodeAlphaMask(originalAlpha, width, height, spread);
  const softenedInterior = await blurSingleChannel(sharp, erodedAlpha, width, height, blurRadius);

  const effectiveOpacity = Math.max(0, Math.min(1, opacity * shadowColor.alpha));
  const softenedPixels = new Uint8Array(softenedInterior);
  const alphaPixels = new Uint8Array(originalAlpha);
  const outPixels = new Uint8Array(Buffer.from(originalRgba));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const originalAlphaValue = alphaPixels[i] ?? 0;
      if (originalAlphaValue === 0) {
        continue;
      }

      const coverageX = x + dx;
      const coverageY = y + dy;
      const coverage =
        coverageX >= 0 && coverageX < width && coverageY >= 0 && coverageY < height
          ? (softenedPixels[coverageY * width + coverageX] ?? 0)
          : 0;

      const innerShadowStrength = Math.max(0, originalAlphaValue - coverage);
      if (innerShadowStrength === 0) {
        continue;
      }

      const shadowAlpha = (innerShadowStrength / 255) * effectiveOpacity;
      if (shadowAlpha <= 0) {
        continue;
      }

      const idx = i * 4;
      outPixels[idx + 0] = Math.round((outPixels[idx + 0] ?? 0) * (1 - shadowAlpha) + shadowColor.r * shadowAlpha);
      outPixels[idx + 1] = Math.round((outPixels[idx + 1] ?? 0) * (1 - shadowAlpha) + shadowColor.g * shadowAlpha);
      outPixels[idx + 2] = Math.round((outPixels[idx + 2] ?? 0) * (1 - shadowAlpha) + shadowColor.b * shadowAlpha);
      outPixels[idx + 3] = originalAlphaValue;
    }
  }

  let pipeline = sharp(Buffer.from(outPixels), {
    raw: { width, height, channels: 4 },
  });

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

  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  const result = {
    ok: true,
    outPath,
    mime,
    bytes: outputBytes.length,
    width,
    height,
    originalWidth: originalInfo.width,
    originalHeight: originalInfo.height,
    innerShadow: {
      color: opts.color || "#000000",
      opacity,
      blur: blurRadius,
      dx,
      dy,
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
