import { extname } from "node:path";
import { DependencyError, FilesystemError, UsageError } from "./errors";

export const DEFAULT_DOWNSIZE_MAX = 2048;

export interface ImageMetadata {
  width: number;
  height: number;
}

export interface ProcessedImage {
  imageBase64: string;
  mimeType: string;
  original?: ImageMetadata;
  processed?: ImageMetadata & { resized: boolean };
}

async function loadSharp(): Promise<any> {
  try {
    const mod: any = await import("sharp");
    return mod?.default ?? mod;
  } catch {
    throw new DependencyError('Image processing requires the "sharp" dependency.', [
      'Run: bun install sharp'
    ]);
  }
}

export function getImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      throw new UsageError(`Unsupported image type: ${ext || "(no extension)"}`, [
        "Supported types: .png, .jpg, .jpeg, .webp"
      ]);
  }
}

export function parseResizeSpec(spec: string, original: number, flagName: string): number {
  const s = spec.trim();
  if (!s) {
    throw new UsageError(`Invalid ${flagName}: empty value`);
  }

  if (s.startsWith("x")) {
    const factor = Number(s.slice(1));
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new UsageError(`Invalid ${flagName}: "${spec}" (expected e.g. "x0.5")`);
    }
    return Math.max(1, Math.round(original * factor));
  }

  const px = Number(s);
  if (!Number.isInteger(px) || px <= 0) {
    throw new UsageError(`Invalid ${flagName}: "${spec}" (expected pixels like "1600")`);
  }
  return px;
}

export async function prepareImageForUpload({
  imagePath,
  downsize,
  maxWidth,
  maxHeight,
}: {
  imagePath: string;
  downsize?: boolean;
  maxWidth?: string;
  maxHeight?: string;
}): Promise<ProcessedImage> {
  const file = Bun.file(imagePath);
  if (!(await file.exists())) {
    throw new FilesystemError(`Image not found or not readable: ${imagePath}`);
  }

  const mimeType = getImageMimeType(imagePath);
  const bytes = await file.arrayBuffer();
  const inputBuffer = Buffer.from(bytes);

  const shouldDownsize = Boolean(downsize || maxWidth || maxHeight);
  
  // If we don't need to downsize, we can just return the original if it's already one of the supported types
  // and we don't need metadata for the output. But the plan says we should include meta.image.original/processed.
  
  const sharp = await loadSharp();
  const image = sharp(inputBuffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new FilesystemError("Failed to read image dimensions.");
  }

  const originalMeta: ImageMetadata = { width: metadata.width, height: metadata.height };

  if (!shouldDownsize) {
    return {
      imageBase64: inputBuffer.toString("base64"),
      mimeType,
      original: originalMeta,
      processed: { ...originalMeta, resized: false }
    };
  }

  const widthLimit =
    maxWidth !== undefined
      ? parseResizeSpec(maxWidth, metadata.width, "--max-width")
      : downsize
        ? DEFAULT_DOWNSIZE_MAX
        : undefined;
  const heightLimit =
    maxHeight !== undefined
      ? parseResizeSpec(maxHeight, metadata.height, "--max-height")
      : downsize
        ? DEFAULT_DOWNSIZE_MAX
        : undefined;

  const needsResize =
    (widthLimit !== undefined && widthLimit < metadata.width) ||
    (heightLimit !== undefined && heightLimit < metadata.height);

  if (!needsResize) {
    return {
      imageBase64: inputBuffer.toString("base64"),
      mimeType,
      original: originalMeta,
      processed: { ...originalMeta, resized: false }
    };
  }

  let pipeline = sharp(inputBuffer)
    .rotate()
    .resize({
      width: widthLimit,
      height: heightLimit,
      fit: "inside",
      withoutEnlargement: true,
    });

  switch (mimeType) {
    case "image/png":
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case "image/webp":
      pipeline = pipeline.webp({ lossless: true });
      break;
    case "image/jpeg":
      pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
      break;
  }

  const outputBuffer = await pipeline.toBuffer();
  const outputMetadata = await sharp(outputBuffer).metadata();

  return {
    imageBase64: outputBuffer.toString("base64"),
    mimeType,
    original: originalMeta,
    processed: {
      width: outputMetadata.width || 0,
      height: outputMetadata.height || 0,
      resized: true
    }
  };
}
