import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface AdjustVibranceOptions {
  out: string;
  amount?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
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

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export async function adjustVibranceCommand(image: string, opts: AdjustVibranceOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon adjust vibrance <image> --out vibrant.png",
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  const amount = opts.amount !== undefined ? parseFloat(opts.amount) : 0.5;

  if (isNaN(amount) || amount < -1 || amount > 1) {
    throw new UsageError(`Invalid --amount: "${opts.amount}" (expected -1..1)`);
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

  // Get raw RGBA pixels
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const pixelCount = info.width * info.height;
  const result = new Uint8Array(pixelCount * 4);

  // Per-pixel vibrance: boost less-saturated pixels more than already-saturated ones
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const r = pixels[off] ?? 0;
    const g = pixels[off + 1] ?? 0;
    const b = pixels[off + 2] ?? 0;
    const a = pixels[off + 3] ?? 0;

    const maxC = Math.max(r, g, b) / 255;
    const avg = (r + g + b) / (3 * 255);
    const currentSat = maxC > 0 ? 1 - avg / maxC : 0;

    // Less-saturated pixels get more boost
    const boost = amount * (1 - currentSat);
    const factor = 1 + boost;

    // Luma (ITU-R BT.601)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    result[off] = clamp(Math.round(gray + (r - gray) * factor), 0, 255);
    result[off + 1] = clamp(Math.round(gray + (g - gray) * factor), 0, 255);
    result[off + 2] = clamp(Math.round(gray + (b - gray) * factor), 0, 255);
    result[off + 3] = a;
  }

  // Build image from raw RGBA buffer
  let pipeline = sharp(Buffer.from(result), {
    raw: { width: info.width, height: info.height, channels: 4 },
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

  const outputResult = {
    ok: true,
    outPath,
    mime,
    bytes: outputBytes.length,
    width: info.width,
    height: info.height,
    vibrance: { amount },
  };

  if (opts.json) {
    renderJson(outputResult);
  } else if (opts.plain) {
    renderPlain(formatPlain(outputResult));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(outputResult));
  }
}
