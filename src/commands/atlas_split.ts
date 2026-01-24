import { resolve, dirname, basename, extname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface AtlasSplitOptions {
  json?: string;
  auto?: boolean;
  out: string;
  metadata?: boolean;
  force?: boolean;
  jsonOutput?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

/** TexturePacker JSON format (hash or array) */
interface TexturePackerFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
}

interface TexturePackerJSON {
  frames: Record<string, TexturePackerFrame> | TexturePackerFrame[];
  meta?: {
    image?: string;
    size?: { w: number; h: number };
    scale?: string;
  };
}

interface SpriteRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExtractedSprite {
  name: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Parse TexturePacker JSON format
 * Supports both hash format (frames as object) and array format
 */
function parseTexturePackerJSON(content: string, jsonPath: string): SpriteRegion[] {
  let data: TexturePackerJSON;
  try {
    data = JSON.parse(content);
  } catch {
    throw new UsageError(`Invalid JSON in ${jsonPath}`);
  }

  if (!data.frames) {
    throw new UsageError(`Invalid TexturePacker JSON: missing "frames" property`, [
      `File: ${jsonPath}`,
    ]);
  }

  const regions: SpriteRegion[] = [];

  if (Array.isArray(data.frames)) {
    // Array format (less common)
    for (let i = 0; i < data.frames.length; i++) {
      const frame = data.frames[i];
      if (!frame || !frame.frame) {
        throw new UsageError(`Invalid frame at index ${i}: missing "frame" property`);
      }
      regions.push({
        name: `sprite_${i}`,
        x: frame.frame.x,
        y: frame.frame.y,
        width: frame.frame.w,
        height: frame.frame.h,
      });
    }
  } else {
    // Hash format (most common)
    for (const [name, frameData] of Object.entries(data.frames)) {
      if (!frameData.frame) {
        throw new UsageError(`Invalid frame "${name}": missing "frame" property`);
      }
      // Remove file extension from name if present
      const cleanName = name.replace(/\.(png|jpg|jpeg|webp)$/i, "");
      regions.push({
        name: cleanName,
        x: frameData.frame.x,
        y: frameData.frame.y,
        width: frameData.frame.w,
        height: frameData.frame.h,
      });
    }
  }

  if (regions.length === 0) {
    throw new UsageError(`No sprite frames found in ${jsonPath}`);
  }

  return regions;
}

/**
 * Auto-detect sprites by finding connected non-transparent regions
 * Uses a flood-fill approach on the alpha channel
 */
async function autoDetectSprites(
  sharp: any,
  imageBuffer: Buffer,
  imageName: string
): Promise<SpriteRegion[]> {
  // Get raw pixel data with alpha channel
  const image = sharp(imageBuffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const width = info.width;
  const height = info.height;
  const channels = 4; // RGBA

  // Create visited map
  const visited = new Uint8Array(width * height);

  // Threshold for considering a pixel as "opaque enough" to be part of a sprite
  const alphaThreshold = 10;

  const regions: SpriteRegion[] = [];
  let spriteIndex = 0;

  // Helper to check if pixel is opaque
  const isOpaque = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (y * width + x) * channels + 3; // Alpha channel
    return (pixels[idx] ?? 0) >= alphaThreshold;
  };

  // Helper to check if visited
  const isVisited = (x: number, y: number): boolean => {
    return visited[y * width + x] === 1;
  };

  // Mark as visited
  const markVisited = (x: number, y: number): void => {
    visited[y * width + x] = 1;
  };

  // Flood-fill to find connected region bounds
  const findRegionBounds = (startX: number, startY: number): { minX: number; minY: number; maxX: number; maxY: number } => {
    let minX = startX, maxX = startX;
    let minY = startY, maxY = startY;

    // Use a queue-based flood fill (BFS) to avoid stack overflow on large sprites
    const queue: Array<[number, number]> = [[startX, startY]];
    markVisited(startX, startY);

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;

      // Update bounds
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      // Check 4-connected neighbors (up, down, left, right)
      const neighbors: Array<[number, number]> = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          if (!isVisited(nx, ny) && isOpaque(nx, ny)) {
            markVisited(nx, ny);
            queue.push([nx, ny]);
          }
        }
      }
    }

    return { minX, minY, maxX, maxY };
  };

  // Scan the image for unvisited opaque pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isVisited(x, y) && isOpaque(x, y)) {
        const bounds = findRegionBounds(x, y);
        const regionWidth = bounds.maxX - bounds.minX + 1;
        const regionHeight = bounds.maxY - bounds.minY + 1;

        // Filter out tiny regions (likely noise)
        if (regionWidth >= 2 && regionHeight >= 2) {
          regions.push({
            name: `${imageName}_${spriteIndex}`,
            x: bounds.minX,
            y: bounds.minY,
            width: regionWidth,
            height: regionHeight,
          });
          spriteIndex++;
        }
      }
    }
  }

  // Sort regions by position (top-to-bottom, left-to-right)
  regions.sort((a, b) => {
    if (Math.abs(a.y - b.y) < 10) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  // Re-index after sorting
  for (let i = 0; i < regions.length; i++) {
    regions[i]!.name = `${imageName}_${i}`;
  }

  return regions;
}

/**
 * Get output format extension from output directory or default to png
 */
function getOutputExtension(outDir: string): string {
  // Default to PNG for sprite extraction (preserves transparency)
  return ".png";
}

function formatPlain(result: {
  outDir: string;
  spriteCount: number;
  sprites: ExtractedSprite[];
}): string {
  const lines = [
    `Output: ${result.outDir}`,
    `Sprites: ${result.spriteCount}`,
    "",
    "Extracted:",
  ];

  for (const sprite of result.sprites) {
    lines.push(`  ${sprite.name}: ${sprite.width}x${sprite.height} @ (${sprite.x}, ${sprite.y})`);
  }

  return lines.join("\n");
}

export async function atlasSplitCommand(image: string, opts: AtlasSplitOptions) {
  // Resolve image path
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);

  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Get image info
  const imageInfo = await getImageInfo(imagePath);
  const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
  const imageName = basename(imagePath, extname(imagePath));

  // Load sharp
  const sharp = await loadSharp();

  // Determine sprite regions
  let regions: SpriteRegion[];

  if (opts.json) {
    // Parse TexturePacker JSON
    const jsonPath = resolve(opts.json);
    const jsonFile = Bun.file(jsonPath);

    if (!(await jsonFile.exists())) {
      throw new FilesystemError(`JSON file not found: ${jsonPath}`);
    }

    const jsonContent = await jsonFile.text();
    regions = parseTexturePackerJSON(jsonContent, jsonPath);
  } else {
    // Auto-detect by transparency
    regions = await autoDetectSprites(sharp, imageBuffer, imageName);

    if (regions.length === 0) {
      throw new UsageError("No sprites detected in image", [
        "The image may not have transparent regions separating sprites.",
        "Try using --json with a TexturePacker JSON file instead.",
      ]);
    }
  }

  // Validate output directory
  const outDir = resolve(opts.out);

  // Check if output directory exists, create if not
  await mkdir(outDir, { recursive: true });

  // Extract each sprite
  const extractedSprites: ExtractedSprite[] = [];
  const ext = getOutputExtension(outDir);

  for (const region of regions) {
    // Validate region is within image bounds
    if (
      region.x < 0 ||
      region.y < 0 ||
      region.x + region.width > imageInfo.width ||
      region.y + region.height > imageInfo.height
    ) {
      throw new UsageError(
        `Sprite "${region.name}" is outside image bounds: (${region.x}, ${region.y}) ${region.width}x${region.height}`,
        [`Image dimensions: ${imageInfo.width}x${imageInfo.height}`]
      );
    }

    // Sanitize sprite name for filename
    const safeName = region.name.replace(/[<>:"/\\|?*]/g, "_");
    const spritePath = join(outDir, `${safeName}${ext}`);

    // Check if file exists
    const spriteFile = Bun.file(spritePath);
    if ((await spriteFile.exists()) && !opts.force) {
      throw new FilesystemError(`Output already exists: ${spritePath}`, [
        "Pass --force to overwrite.",
      ]);
    }

    // Extract sprite region
    const spriteBuffer = await sharp(imageBuffer)
      .extract({
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    // Write sprite
    await Bun.write(spritePath, spriteBuffer);

    extractedSprites.push({
      name: region.name,
      path: spritePath,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      bytes: spriteBuffer.length,
    });
  }

  // Generate metadata if requested
  let metadataPath: string | null = null;
  if (opts.metadata) {
    const metadataContent = {
      source: imagePath,
      sourceWidth: imageInfo.width,
      sourceHeight: imageInfo.height,
      sprites: extractedSprites.map((s) => ({
        name: s.name,
        file: basename(s.path),
        frame: { x: s.x, y: s.y, w: s.width, h: s.height },
      })),
    };

    metadataPath = join(outDir, "sprites.json");
    await Bun.write(metadataPath, JSON.stringify(metadataContent, null, 2));
  }

  // Build result
  const result = {
    ok: true,
    outDir,
    source: imagePath,
    sourceWidth: imageInfo.width,
    sourceHeight: imageInfo.height,
    spriteCount: extractedSprites.length,
    detectionMethod: opts.json ? "texturepacker-json" : "auto-transparency",
    metadataPath,
    sprites: extractedSprites,
  };

  // Output handling
  if (opts.jsonOutput) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
