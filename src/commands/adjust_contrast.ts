import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface AdjustContrastOptions {
  out: string;
  factor?: string;
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

export async function adjustContrastCommand(image: string, opts: AdjustContrastOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon adjust contrast <image> --out contrasted.png",
    ]);
  }

  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  const factor = opts.factor !== undefined ? parseFloat(opts.factor) : 1.0;

  if (isNaN(factor) || factor < 0 || factor > 10) {
    throw new UsageError(`Invalid --factor: "${opts.factor}" (expected 0..10)`);
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

  // linear(a, b) applies: output = a * input + b
  // Center around middle gray (128): b = 128 * (1 - factor)
  const a = factor;
  const b = 128 * (1 - factor);

  let pipeline = sharp(inputBuffer).linear(a, b);

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
    width: originalInfo.width,
    height: originalInfo.height,
    contrast: { factor },
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
