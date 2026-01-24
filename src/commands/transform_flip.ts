import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface TransformFlipOptions {
  out: string;
  horizontal?: boolean;
  vertical?: boolean;
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
  horizontal: boolean;
  vertical: boolean;
}): string {
  const flips: string[] = [];
  if (result.horizontal) flips.push("horizontal");
  if (result.vertical) flips.push("vertical");

  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Flip: ${flips.length > 0 ? flips.join(", ") : "none"}`,
  ].join("\n");
}

export async function transformFlipCommand(image: string, opts: TransformFlipOptions) {
  // Validate input
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      "Usage: eikon transform flip <image> --horizontal --out flipped.png",
    ]);
  }

  // Validate input file exists
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Validate at least one flip direction is specified
  const horizontal = opts.horizontal || false;
  const vertical = opts.vertical || false;

  if (!horizontal && !vertical) {
    throw new UsageError("At least one flip direction is required", [
      "Use --horizontal, --vertical, or both.",
      "Example: eikon transform flip image.png --horizontal --out flipped.png",
    ]);
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

  // Load sharp and process
  const sharp = await loadSharp();
  const inputBuffer = Buffer.from(await imageFile.arrayBuffer());

  let pipeline = sharp(inputBuffer);

  // Apply flips - sharp uses flop() for horizontal and flip() for vertical
  if (horizontal) {
    pipeline = pipeline.flop();
  }
  if (vertical) {
    pipeline = pipeline.flip();
  }

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
    width: originalInfo.width,
    height: originalInfo.height,
    horizontal,
    vertical,
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
