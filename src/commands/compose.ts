import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface ComposeOptions {
  layer: string[];
  out: string;
  width?: string;
  height?: string;
  bgColor?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

interface ParsedLayer {
  path: string;
  opacity: number;
  blend: string;
  offsetX: number;
  offsetY: number;
}

interface LayerInfo {
  path: string;
  opacity: number;
  blend: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

// Sharp blend modes
const VALID_BLEND_MODES = [
  "over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "add",
  "saturate",
  "dest-over",
  "dest-in",
  "dest-out",
  "dest-atop",
  "xor",
] as const;

type BlendMode = (typeof VALID_BLEND_MODES)[number];

/**
 * Parse layer specification: <path>[@<x>,<y>][:<opacity>][:<blend>]
 * Examples:
 *   image.png
 *   image.png:0.5
 *   image.png::multiply
 *   image.png:0.5:multiply
 *   image.png@50,30
 *   image.png@-20,-20:0.8
 *   image.png@0,0::multiply
 *   image.png@100,50:0.5:screen
 */
function parseLayerSpec(spec: string): ParsedLayer {
  // Extract @x,y offset if present (before parsing colons)
  let offsetX = 0;
  let offsetY = 0;
  let specWithoutOffset = spec;

  const offsetMatch = spec.match(/@(-?\d+),(-?\d+)/);
  if (offsetMatch && offsetMatch.index !== undefined) {
    offsetX = parseInt(offsetMatch[1]!, 10);
    offsetY = parseInt(offsetMatch[2]!, 10);
    specWithoutOffset =
      spec.slice(0, offsetMatch.index) +
      spec.slice(offsetMatch.index + offsetMatch[0].length);
  }

  // Split on colons, but we need to handle Windows paths (C:\...)
  // Strategy: find first colon that could start opacity/blend section
  // A colon followed by a digit or another colon is likely opacity/blend

  let path: string;
  let opacityStr: string | undefined;
  let blendStr: string | undefined;

  // Find potential split points - colons followed by digit, dot, or colon
  const colonRegex = /:([\d.]|:)/g;
  let match: RegExpExecArray | null = null;
  let firstSplitIndex = -1;

  while ((match = colonRegex.exec(specWithoutOffset)) !== null) {
    // Check if this looks like the start of opacity/blend section
    const afterColon = specWithoutOffset.slice(match.index + 1);
    // If it's a digit/dot or another colon, this is likely our split point
    if (/^[\d.:]/.test(afterColon)) {
      firstSplitIndex = match.index;
      break;
    }
  }

  if (firstSplitIndex === -1) {
    // No opacity/blend section
    path = specWithoutOffset;
  } else {
    path = specWithoutOffset.slice(0, firstSplitIndex);
    const rest = specWithoutOffset.slice(firstSplitIndex + 1);
    const parts = rest.split(":");

    if (parts.length >= 1 && parts[0] !== "") {
      opacityStr = parts[0];
    }
    if (parts.length >= 2 && parts[1] !== "") {
      blendStr = parts[1];
    }
  }

  // Validate path
  if (!path) {
    throw new UsageError(`Invalid layer spec: "${spec}" (missing path)`);
  }

  // Parse opacity (default: 1)
  let opacity = 1;
  if (opacityStr !== undefined) {
    opacity = parseFloat(opacityStr);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new UsageError(`Invalid layer opacity: "${opacityStr}" (expected 0-1)`, [
        `Layer spec: "${spec}"`,
      ]);
    }
  }

  // Parse blend mode (default: over)
  let blend: string = "over";
  if (blendStr !== undefined) {
    const normalizedBlend = blendStr.toLowerCase();
    if (!VALID_BLEND_MODES.includes(normalizedBlend as BlendMode)) {
      throw new UsageError(`Invalid blend mode: "${blendStr}"`, [
        `Valid modes: ${VALID_BLEND_MODES.join(", ")}`,
      ]);
    }
    blend = normalizedBlend;
  }

  return { path: resolve(path), opacity, blend, offsetX, offsetY };
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

/**
 * Apply opacity to an image buffer by multiplying alpha channel values
 */
async function applyOpacity(
  sharp: any,
  inputBuffer: Buffer,
  opacity: number
): Promise<Buffer> {
  if (opacity >= 1) {
    return inputBuffer;
  }

  // Get image with alpha channel
  const image = sharp(inputBuffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  // Multiply alpha channel by opacity
  const pixels = new Uint8Array(data);
  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = Math.round((pixels[i] ?? 0) * opacity);
  }

  // Convert back to PNG buffer
  return sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

/**
 * Resize image to fit within dimensions, centering if smaller
 */
async function prepareLayerBuffer(
  sharp: any,
  inputBuffer: Buffer,
  targetWidth: number,
  targetHeight: number,
  opacity: number
): Promise<Buffer> {
  const metadata = await sharp(inputBuffer).metadata();
  const srcWidth = metadata.width || targetWidth;
  const srcHeight = metadata.height || targetHeight;

  let processedBuffer: Buffer;

  if (srcWidth > targetWidth || srcHeight > targetHeight) {
    // Resize to fit inside target dimensions
    processedBuffer = await sharp(inputBuffer)
      .ensureAlpha()
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "inside",
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
  } else {
    // Keep original size, ensure alpha
    processedBuffer = await sharp(inputBuffer).ensureAlpha().png().toBuffer();
  }

  // Apply opacity
  return applyOpacity(sharp, processedBuffer, opacity);
}

/**
 * Calculate position to center a layer on the canvas
 */
function centerPosition(
  layerWidth: number,
  layerHeight: number,
  canvasWidth: number,
  canvasHeight: number
): { left: number; top: number } {
  return {
    left: Math.round((canvasWidth - layerWidth) / 2),
    top: Math.round((canvasHeight - layerHeight) / 2),
  };
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  layerCount: number;
}): string {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Layers: ${result.layerCount}`,
  ].join("\n");
}

export async function composeCommand(opts: ComposeOptions) {
  // Validate layer count
  const layerSpecs = opts.layer || [];
  if (layerSpecs.length < 2) {
    throw new UsageError("At least 2 layers are required", [
      "Usage: eikon compose --layer base.png --layer overlay.png --out result.png",
    ]);
  }

  // Parse all layer specs
  const parsedLayers: ParsedLayer[] = layerSpecs.map(parseLayerSpec);

  // Validate all layer files exist and get their info
  const layerInfos: LayerInfo[] = [];
  for (const layer of parsedLayers) {
    const file = Bun.file(layer.path);
    if (!(await file.exists())) {
      throw new FilesystemError(`Layer file not found: ${layer.path}`);
    }
    const info = await getImageInfo(layer.path);
    layerInfos.push({
      ...layer,
      width: info.width,
      height: info.height,
    });
  }

  // Determine output dimensions (first layer is guaranteed to exist since we validated >= 2 layers)
  const firstLayer = layerInfos[0]!;
  let outputWidth: number;
  let outputHeight: number;

  if (opts.width) {
    outputWidth = parseInt(opts.width, 10);
    if (!Number.isInteger(outputWidth) || outputWidth <= 0) {
      throw new UsageError(`Invalid width: "${opts.width}" (expected positive integer)`);
    }
  } else {
    outputWidth = firstLayer.width;
  }

  if (opts.height) {
    outputHeight = parseInt(opts.height, 10);
    if (!Number.isInteger(outputHeight) || outputHeight <= 0) {
      throw new UsageError(`Invalid height: "${opts.height}" (expected positive integer)`);
    }
  } else {
    outputHeight = firstLayer.height;
  }

  // Parse background color if provided
  let bgColor: { r: number; g: number; b: number; alpha: number } | null = null;
  if (opts.bgColor) {
    bgColor = parseHexColor(opts.bgColor);
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

  // Load sharp
  const sharp = await loadSharp();

  // Create base canvas
  let pipeline: any;

  if (bgColor) {
    // Start with solid color background
    pipeline = sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: bgColor,
      },
    });
  } else {
    // Start with transparent background, use first layer as base
    pipeline = sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
  }

  // Build composite operations
  const compositeOps: Array<{
    input: Buffer;
    left: number;
    top: number;
    blend: string;
  }> = [];

  for (const layer of layerInfos) {
    // Read layer file
    const file = Bun.file(layer.path);
    const bytes = await file.arrayBuffer();
    const inputBuffer = Buffer.from(bytes);

    // Prepare layer buffer (resize if needed, apply opacity)
    const preparedBuffer = await prepareLayerBuffer(
      sharp,
      inputBuffer,
      outputWidth,
      outputHeight,
      layer.opacity
    );

    // Get dimensions of prepared buffer for centering
    const preparedMeta = await sharp(preparedBuffer).metadata();
    const preparedWidth = preparedMeta.width || outputWidth;
    const preparedHeight = preparedMeta.height || outputHeight;

    // Calculate center position and apply offset
    const pos = centerPosition(preparedWidth, preparedHeight, outputWidth, outputHeight);

    compositeOps.push({
      input: preparedBuffer,
      left: pos.left + layer.offsetX,
      top: pos.top + layer.offsetY,
      blend: layer.blend,
    });
  }

  // Apply all composites
  pipeline = pipeline.composite(compositeOps);

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
    // JPEG doesn't support alpha, flatten with background
    const flattenBg = bgColor || { r: 255, g: 255, b: 255 };
    outputBytes = await pipeline
      .flatten({ background: { r: flattenBg.r, g: flattenBg.g, b: flattenBg.b } })
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
    width: outputWidth,
    height: outputHeight,
    layerCount: layerInfos.length,
    layers: layerInfos.map((l) => ({
      path: l.path,
      opacity: l.opacity,
      blend: l.blend,
      offsetX: l.offsetX,
      offsetY: l.offsetY,
      originalWidth: l.width,
      originalHeight: l.height,
    })),
    bgColor: opts.bgColor || null,
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
