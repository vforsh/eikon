import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";
import { parseMaskSpec, buildMaskSvg } from "../mask";

export interface TransformMaskOptions {
  shape: string;
  out: string;
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

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  shape: string;
}): string {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Shape: ${result.shape}`,
  ].join("\n");
}

export async function transformMaskCommand(image: string, opts: TransformMaskOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      'Usage: eikon transform mask <image> --shape <spec> --out masked.png',
    ]);
  }

  // Validate input file exists
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
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
  const { width, height } = originalInfo;

  // Parse shape specification
  const mask = parseMaskSpec(opts.shape, width, height);
  if (mask.type === "none") {
    throw new UsageError('--shape is required (e.g. "circle", "rounded", "squircle")');
  }

  // Load sharp and read input
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  // Build SVG mask
  const maskSvg = buildMaskSvg(width, height, mask);
  const maskBuffer = await sharp(Buffer.from(maskSvg))
    .ensureAlpha()
    .toBuffer();

  // Apply mask via dest-in composite
  const baseBuffer = await sharp(inputBuffer)
    .ensureAlpha()
    .png()
    .toBuffer();

  let pipeline = sharp(baseBuffer)
    .composite([{ input: maskBuffer, blend: "dest-in" }]);

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
    command: "transform mask",
    outPath,
    mime,
    bytes: outputBytes.length,
    width,
    height,
    shape: opts.shape,
    mask,
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
