import { resolve, basename, extname, dirname } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { MaxRectsPacker } from "maxrects-packer";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface AtlasCreateOptions {
  out: string;
  padding?: string;
  json?: boolean; // --no-json sets this to false
  format?: "hash" | "array";
  force?: boolean;
  jsonOutput?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

interface SpriteInput {
  name: string;
  path: string;
  width: number;
  height: number;
  buffer: Buffer;
}

interface PackedSprite {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_SIZE = 4096;
const DEFAULT_PADDING = 1;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function isImageFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

async function collectImages(inputs: string[]): Promise<string[]> {
  const imagePaths: string[] = [];

  for (const input of inputs) {
    const inputPath = resolve(input);
    const inputStat = await stat(inputPath).catch(() => null);

    if (!inputStat) {
      throw new FilesystemError(`Path not found: ${inputPath}`);
    }

    if (inputStat.isDirectory()) {
      // Read directory and collect image files
      const entries = await readdir(inputPath);
      for (const entry of entries) {
        if (isImageFile(entry)) {
          imagePaths.push(resolve(inputPath, entry));
        }
      }
    } else if (inputStat.isFile()) {
      if (!isImageFile(inputPath)) {
        throw new UsageError(`Not an image file: ${inputPath}`, [
          "Supported formats: .png, .jpg, .jpeg, .webp",
        ]);
      }
      imagePaths.push(inputPath);
    }
  }

  if (imagePaths.length === 0) {
    throw new UsageError("No image files found", [
      "Provide image files or a directory containing images.",
    ]);
  }

  // Sort for consistent ordering
  imagePaths.sort();

  return imagePaths;
}

async function loadSprites(imagePaths: string[]): Promise<SpriteInput[]> {
  const sprites: SpriteInput[] = [];

  for (const imagePath of imagePaths) {
    const file = Bun.file(imagePath);
    const buffer = Buffer.from(await file.arrayBuffer());
    const info = await getImageInfo(imagePath);
    const name = basename(imagePath, extname(imagePath));

    sprites.push({
      name,
      path: imagePath,
      width: info.width,
      height: info.height,
      buffer,
    });
  }

  return sprites;
}

function generateTexturePackerJSON(
  atlasPath: string,
  atlasWidth: number,
  atlasHeight: number,
  sprites: PackedSprite[],
  format: "hash" | "array"
): object {
  const meta = {
    app: "eikon",
    version: "1.0",
    image: basename(atlasPath),
    format: "RGBA8888",
    size: { w: atlasWidth, h: atlasHeight },
    scale: "1",
  };

  if (format === "array") {
    const frames = sprites.map((sprite) => ({
      filename: sprite.name,
      frame: { x: sprite.x, y: sprite.y, w: sprite.width, h: sprite.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: sprite.width, h: sprite.height },
      sourceSize: { w: sprite.width, h: sprite.height },
    }));
    return { frames, meta };
  }

  // Hash format (default)
  const frames: Record<string, object> = {};
  for (const sprite of sprites) {
    frames[sprite.name] = {
      frame: { x: sprite.x, y: sprite.y, w: sprite.width, h: sprite.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: sprite.width, h: sprite.height },
      sourceSize: { w: sprite.width, h: sprite.height },
    };
  }
  return { frames, meta };
}

function formatPlain(result: {
  atlasPath: string;
  atlasWidth: number;
  atlasHeight: number;
  spriteCount: number;
  jsonPath: string | null;
  sprites: PackedSprite[];
}): string {
  const lines = [
    `Atlas: ${result.atlasPath}`,
    `Size: ${result.atlasWidth}x${result.atlasHeight}`,
    `Sprites: ${result.spriteCount}`,
  ];

  if (result.jsonPath) {
    lines.push(`JSON: ${result.jsonPath}`);
  }

  lines.push("", "Packed:");
  for (const sprite of result.sprites) {
    lines.push(
      `  ${sprite.name}: ${sprite.width}x${sprite.height} @ (${sprite.x}, ${sprite.y})`
    );
  }

  return lines.join("\n");
}

export async function atlasCreateCommand(
  inputs: string[],
  opts: AtlasCreateOptions
) {
  // Collect all image paths
  const imagePaths = await collectImages(inputs);

  // Load all sprites
  const sprites = await loadSprites(imagePaths);

  // Parse padding
  const padding = opts.padding ? parseInt(opts.padding, 10) : DEFAULT_PADDING;
  if (isNaN(padding) || padding < 0) {
    throw new UsageError(`Invalid padding value: ${opts.padding}`, [
      "Padding must be a non-negative integer.",
    ]);
  }

  // Create packer with max size constraints
  // smart: true enables smart bin selection
  // pot: false allows non-power-of-2 sizes
  // square: false allows non-square output
  // allowRotation: false for simplicity
  const packer = new MaxRectsPacker(MAX_SIZE, MAX_SIZE, padding, {
    smart: true,
    pot: false,
    square: false,
    allowRotation: false,
  });

  // Add all sprites to packer
  for (const sprite of sprites) {
    packer.add(sprite.width, sprite.height, { name: sprite.name, sprite });
  }

  // Check if all sprites fit in a single bin
  if (packer.bins.length === 0) {
    throw new UsageError("No sprites could be packed", [
      "Check that sprite files are valid images.",
    ]);
  }

  if (packer.bins.length > 1) {
    // Calculate total area needed
    const totalArea = sprites.reduce(
      (sum, s) => sum + (s.width + padding) * (s.height + padding),
      0
    );
    const maxArea = MAX_SIZE * MAX_SIZE;

    throw new UsageError(
      `Sprites don't fit in a single ${MAX_SIZE}x${MAX_SIZE} atlas`,
      [
        `${sprites.length} sprites require approximately ${Math.ceil(totalArea / 1000000)}MP, max is ${Math.ceil(maxArea / 1000000)}MP.`,
        "Reduce the number or size of sprites.",
      ]
    );
  }

  const bin = packer.bins[0]!;
  const atlasWidth = bin.width;
  const atlasHeight = bin.height;

  // Validate output path
  const outPath = resolve(opts.out);
  const outExt = extname(outPath).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(outExt)) {
    throw new UsageError(`Invalid output format: ${outExt}`, [
      "Supported formats: .png, .jpg, .jpeg, .webp",
    ]);
  }

  // Check if output exists
  const outFile = Bun.file(outPath);
  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, [
      "Pass --force to overwrite.",
    ]);
  }

  // Load sharp
  const sharp = await loadSharp();

  // Create composite operations
  const compositeOps: Array<{
    input: Buffer;
    left: number;
    top: number;
  }> = [];

  const packedSprites: PackedSprite[] = [];

  for (const rect of bin.rects) {
    const data = rect.data as { name: string; sprite: SpriteInput };
    const sprite = data.sprite;

    compositeOps.push({
      input: sprite.buffer,
      left: rect.x,
      top: rect.y,
    });

    packedSprites.push({
      name: data.name,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  // Create atlas image
  const atlasBuffer = await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(compositeOps)
    .png({ compressionLevel: 9 })
    .toBuffer();

  // Convert to target format if not PNG
  let finalBuffer: Buffer;
  if (outExt === ".png") {
    finalBuffer = atlasBuffer;
  } else if (outExt === ".jpg" || outExt === ".jpeg") {
    finalBuffer = await sharp(atlasBuffer).jpeg({ quality: 90 }).toBuffer();
  } else if (outExt === ".webp") {
    finalBuffer = await sharp(atlasBuffer).webp({ quality: 90 }).toBuffer();
  } else {
    finalBuffer = atlasBuffer;
  }

  // Write atlas
  await Bun.write(outPath, finalBuffer);

  // Generate JSON if not disabled (--no-json sets opts.json to false)
  let jsonPath: string | null = null;
  if (opts.json !== false) {
    const format = opts.format || "hash";
    const jsonData = generateTexturePackerJSON(
      outPath,
      atlasWidth,
      atlasHeight,
      packedSprites,
      format
    );

    jsonPath = outPath.replace(/\.[^.]+$/, ".json");

    // Check if JSON exists
    const jsonFile = Bun.file(jsonPath);
    if ((await jsonFile.exists()) && !opts.force) {
      throw new FilesystemError(`JSON file already exists: ${jsonPath}`, [
        "Pass --force to overwrite.",
      ]);
    }

    await Bun.write(jsonPath, JSON.stringify(jsonData, null, 2));
  }

  // Build result
  const result = {
    ok: true,
    atlasPath: outPath,
    atlasWidth,
    atlasHeight,
    atlasBytes: finalBuffer.length,
    spriteCount: packedSprites.length,
    jsonPath,
    jsonFormat: opts.json === false ? null : opts.format || "hash",
    sprites: packedSprites,
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
