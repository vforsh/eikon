import { resolve, basename, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface AtlasExtractOptions {
  json: string;
  out: string;
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

interface FrameData {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExtractedFrame {
  name: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Convert a glob pattern to a regular expression
 * Supports * (any characters) and ? (single character)
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars except * and ?
    .replace(/\*/g, ".*") // * matches any characters
    .replace(/\?/g, "."); // ? matches single character
  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a pattern contains glob characters
 */
function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

/**
 * Parse TexturePacker JSON and return a map of frame names to frame data
 */
function parseTexturePackerJSON(
  content: string,
  jsonPath: string
): Map<string, FrameData> {
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

  const frameMap = new Map<string, FrameData>();

  if (Array.isArray(data.frames)) {
    // Array format - frames are indexed by number
    for (let i = 0; i < data.frames.length; i++) {
      const frame = data.frames[i];
      if (!frame || !frame.frame) {
        throw new UsageError(`Invalid frame at index ${i}: missing "frame" property`);
      }
      const name = `sprite_${i}`;
      frameMap.set(name, {
        name,
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
      // Store both with and without extension for flexible matching
      const cleanName = name.replace(/\.(png|jpg|jpeg|webp)$/i, "");
      frameMap.set(cleanName, {
        name: cleanName,
        x: frameData.frame.x,
        y: frameData.frame.y,
        width: frameData.frame.w,
        height: frameData.frame.h,
      });
      // Also store with original name if different
      if (cleanName !== name) {
        frameMap.set(name, {
          name: cleanName,
          x: frameData.frame.x,
          y: frameData.frame.y,
          width: frameData.frame.w,
          height: frameData.frame.h,
        });
      }
    }
  }

  if (frameMap.size === 0) {
    throw new UsageError(`No sprite frames found in ${jsonPath}`);
  }

  return frameMap;
}

/**
 * Get available frame names for error messages
 */
function getAvailableFrameNames(frameMap: Map<string, FrameData>): string[] {
  // Filter out duplicates (original name vs clean name)
  const seen = new Set<string>();
  const names: string[] = [];
  for (const [, data] of frameMap) {
    if (!seen.has(data.name)) {
      seen.add(data.name);
      names.push(data.name);
    }
  }
  return names.sort();
}

function formatPlain(result: {
  outDir: string;
  frameCount: number;
  frames: ExtractedFrame[];
}): string {
  const lines = [
    `Output: ${result.outDir}`,
    `Frames: ${result.frameCount}`,
    "",
    "Extracted:",
  ];

  for (const frame of result.frames) {
    lines.push(`  ${frame.name}: ${frame.width}x${frame.height} @ (${frame.x}, ${frame.y})`);
  }

  return lines.join("\n");
}

export async function atlasExtractCommand(
  image: string,
  frameNames: string[],
  opts: AtlasExtractOptions
) {
  // Resolve image path
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);

  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Get image info
  const imageInfo = await getImageInfo(imagePath);
  const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

  // Load sharp
  const sharp = await loadSharp();

  // Parse TexturePacker JSON
  const jsonPath = resolve(opts.json);
  const jsonFile = Bun.file(jsonPath);

  if (!(await jsonFile.exists())) {
    throw new FilesystemError(`JSON file not found: ${jsonPath}`);
  }

  const jsonContent = await jsonFile.text();
  const frameMap = parseTexturePackerJSON(jsonContent, jsonPath);

  // Validate requested frame names (supports glob patterns)
  const framesToExtract: FrameData[] = [];
  const notFound: string[] = [];
  const allFrameNames = getAvailableFrameNames(frameMap);

  for (const pattern of frameNames) {
    if (isGlobPattern(pattern)) {
      // Glob pattern - match against all frame names
      const regex = globToRegex(pattern);
      const matches = allFrameNames.filter((name) => regex.test(name));

      if (matches.length === 0) {
        notFound.push(pattern);
      } else {
        for (const name of matches) {
          const frame = frameMap.get(name);
          if (frame && !framesToExtract.some((f) => f.name === frame.name)) {
            framesToExtract.push(frame);
          }
        }
      }
    } else {
      // Exact match
      const frame = frameMap.get(pattern);
      if (frame) {
        if (!framesToExtract.some((f) => f.name === frame.name)) {
          framesToExtract.push(frame);
        }
      } else {
        notFound.push(pattern);
      }
    }
  }

  if (notFound.length > 0) {
    const availableList =
      allFrameNames.length <= 10
        ? allFrameNames.join(", ")
        : `${allFrameNames.slice(0, 10).join(", ")} ... (${allFrameNames.length} total)`;

    throw new UsageError(`Frame(s) not found: ${notFound.join(", ")}`, [
      `Available frames: ${availableList}`,
    ]);
  }

  if (framesToExtract.length === 0) {
    throw new UsageError("No frames specified to extract");
  }

  // Validate output directory
  const outDir = resolve(opts.out);
  await mkdir(outDir, { recursive: true });

  // Extract each frame
  const extractedFrames: ExtractedFrame[] = [];

  for (const frame of framesToExtract) {
    // Validate frame is within image bounds
    if (
      frame.x < 0 ||
      frame.y < 0 ||
      frame.x + frame.width > imageInfo.width ||
      frame.y + frame.height > imageInfo.height
    ) {
      throw new UsageError(
        `Frame "${frame.name}" is outside image bounds: (${frame.x}, ${frame.y}) ${frame.width}x${frame.height}`,
        [`Image dimensions: ${imageInfo.width}x${imageInfo.height}`]
      );
    }

    // Sanitize frame name for filename
    const safeName = frame.name.replace(/[<>:"/\\|?*]/g, "_");
    const framePath = join(outDir, `${safeName}.png`);

    // Check if file exists
    const frameFile = Bun.file(framePath);
    if ((await frameFile.exists()) && !opts.force) {
      throw new FilesystemError(`Output already exists: ${framePath}`, [
        "Pass --force to overwrite.",
      ]);
    }

    // Extract frame region
    const frameBuffer = await sharp(imageBuffer)
      .extract({
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();

    // Write frame
    await Bun.write(framePath, frameBuffer);

    extractedFrames.push({
      name: frame.name,
      path: framePath,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      bytes: frameBuffer.length,
    });
  }

  // Build result
  const result = {
    ok: true,
    outDir,
    source: imagePath,
    sourceWidth: imageInfo.width,
    sourceHeight: imageInfo.height,
    frameCount: extractedFrames.length,
    frames: extractedFrames,
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
