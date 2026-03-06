import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp, getImageInfo } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface InpaintMaskOptions {
  out: string;
  region?: string[];
  detect?: string;
  tolerance?: string;
  invert?: boolean;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

interface MaskRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseHexColor(color: string): [number, number, number] {
  const hex = color.startsWith("#") ? color.slice(1) : color;

  let r: number, g: number, b: number;

  if (hex.length === 3) {
    const rH = hex.charAt(0);
    const gH = hex.charAt(1);
    const bH = hex.charAt(2);
    r = parseInt(rH + rH, 16);
    g = parseInt(gH + gH, 16);
    b = parseInt(bH + bH, 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    throw new UsageError(`Invalid hex color: "${color}"`, [
      "Supported formats: #RGB, #RRGGBB",
    ]);
  }

  if ([r, g, b].some((v) => isNaN(v) || v < 0 || v > 255)) {
    throw new UsageError(`Invalid hex color: "${color}"`);
  }

  return [r, g, b];
}

function parseValue(valueStr: string, dimension: number): number {
  if (valueStr.endsWith("%")) {
    const pct = parseFloat(valueStr.slice(0, -1));
    if (isNaN(pct) || pct < 0 || pct > 100) {
      throw new UsageError(`Invalid percentage: "${valueStr}"`);
    }
    return Math.round((pct / 100) * dimension);
  }
  const px = parseInt(valueStr, 10);
  if (!Number.isInteger(px) || px < 0) {
    throw new UsageError(`Invalid pixel value: "${valueStr}"`);
  }
  return px;
}

function resolveRegion(spec: string, imgW: number, imgH: number): MaskRegion[] {
  const colonIdx = spec.indexOf(":");
  if (colonIdx === -1) {
    throw new UsageError(`Invalid region spec: "${spec}"`, [
      'Expected format: "left:<px>", "right:<px>", "top:<px>", "bottom:<px>", "border:<px>", or "rect:<x>,<y>,<w>,<h>"',
    ]);
  }

  const type = spec.slice(0, colonIdx);
  const valueStr = spec.slice(colonIdx + 1);

  switch (type) {
    case "left": {
      const v = parseValue(valueStr, imgW);
      return [{ x: 0, y: 0, w: v, h: imgH }];
    }
    case "right": {
      const v = parseValue(valueStr, imgW);
      return [{ x: imgW - v, y: 0, w: v, h: imgH }];
    }
    case "top": {
      const v = parseValue(valueStr, imgH);
      return [{ x: 0, y: 0, w: imgW, h: v }];
    }
    case "bottom": {
      const v = parseValue(valueStr, imgH);
      return [{ x: 0, y: imgH - v, w: imgW, h: v }];
    }
    case "border": {
      const v = parseValue(valueStr, Math.min(imgW, imgH));
      return [
        { x: 0, y: 0, w: v, h: imgH },           // left
        { x: imgW - v, y: 0, w: v, h: imgH },     // right
        { x: 0, y: 0, w: imgW, h: v },             // top
        { x: 0, y: imgH - v, w: imgW, h: v },      // bottom
      ];
    }
    case "rect": {
      const parts = valueStr.split(",");
      if (parts.length !== 4) {
        throw new UsageError(`Invalid rect spec: "${spec}"`, [
          'Expected format: "rect:<x>,<y>,<w>,<h>"',
        ]);
      }
      const x = parseInt(parts[0]!, 10);
      const y = parseInt(parts[1]!, 10);
      const w = parseInt(parts[2]!, 10);
      const h = parseInt(parts[3]!, 10);
      if ([x, y, w, h].some((v) => !Number.isInteger(v) || v < 0)) {
        throw new UsageError(`Invalid rect values: "${spec}"`);
      }
      return [{ x, y, w, h }];
    }
    default:
      throw new UsageError(`Unknown region type: "${type}"`, [
        "Supported types: left, right, top, bottom, border, rect",
      ]);
  }
}

function formatPlain(result: Record<string, unknown>): string {
  const lines = [
    `Path: ${result.outPath}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
  ];
  if (result.mode) {
    lines.push(`Mode: ${result.mode}`);
  }
  return lines.join("\n");
}

export async function inpaintMaskCommand(image: string, opts: InpaintMaskOptions) {
  if (!image) {
    throw new UsageError("Missing <image> argument", [
      'Usage: eikon inpaint-mask <image> --region "left:48" --out mask.png',
    ]);
  }

  // Validate input
  const imagePath = resolve(image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Validate output
  const outPath = resolve(opts.out);
  if (!outPath.toLowerCase().endsWith(".png")) {
    throw new UsageError("--out path must have .png extension (masks are always PNG)");
  }
  const outFile = Bun.file(outPath);
  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, [
      "Pass --force to overwrite.",
    ]);
  }

  // Validate mode: --region or --detect, not both
  const hasRegion = opts.region && opts.region.length > 0;
  const hasDetect = Boolean(opts.detect);
  if (!hasRegion && !hasDetect) {
    throw new UsageError("Must specify --region or --detect", [
      'Example: eikon inpaint-mask photo.png --region "left:48" --out mask.png',
      'Example: eikon inpaint-mask photo.png --detect "#FF00FF" --out mask.png',
    ]);
  }
  if (hasRegion && hasDetect) {
    throw new UsageError("Cannot use both --region and --detect");
  }

  const info = await getImageInfo(imagePath);
  const { width, height } = info;
  const sharp = await loadSharp();

  let maskBuffer: Buffer;

  if (hasRegion) {
    // Region-based mask: black canvas, overlay white rects for each region
    const regions: MaskRegion[] = [];
    for (const spec of opts.region!) {
      regions.push(...resolveRegion(spec, width, height));
    }

    // Build white rectangles for compositing
    const composites: { input: Buffer; top: number; left: number }[] = [];
    const regionColor = opts.invert ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

    for (const region of regions) {
      if (region.w <= 0 || region.h <= 0) continue;
      const clampedW = Math.min(region.w, width - region.x);
      const clampedH = Math.min(region.h, height - region.y);
      if (clampedW <= 0 || clampedH <= 0) continue;

      const rect = await sharp({
        create: {
          width: clampedW,
          height: clampedH,
          channels: 3,
          background: regionColor,
        },
      }).png().toBuffer();

      composites.push({ input: rect, top: region.y, left: region.x });
    }

    const baseColor = opts.invert ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
    let pipeline = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: baseColor,
      },
    });

    if (composites.length > 0) {
      pipeline = pipeline.composite(composites);
    }

    maskBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else {
    // Color detection mode
    const [tr, tg, tb] = parseHexColor(opts.detect!);
    const tolerance = opts.tolerance ? parseInt(opts.tolerance, 10) : 0;
    if (isNaN(tolerance) || tolerance < 0 || tolerance > 255) {
      throw new UsageError("--tolerance must be 0-255");
    }

    const inputBuffer = Buffer.from(await imageFile.arrayBuffer());
    const { data, info: rawInfo } = await sharp(inputBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = rawInfo.channels;
    const pixelCount = rawInfo.width * rawInfo.height;
    const maskData = Buffer.alloc(pixelCount);
    const maxDist = tolerance * 3;

    for (let i = 0; i < pixelCount; i++) {
      const offset = i * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const dist = Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb);
      const match = dist <= maxDist;
      maskData[i] = (match !== Boolean(opts.invert)) ? 255 : 0;
    }

    maskBuffer = await sharp(maskData, {
      raw: { width: rawInfo.width, height: rawInfo.height, channels: 1 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  // Write output
  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, maskBuffer);

  // Build result
  const result: Record<string, unknown> = {
    ok: true,
    command: "inpaint-mask",
    outPath,
    bytes: maskBuffer.length,
    width,
    height,
    mode: hasRegion ? "region" : "detect",
    inverted: Boolean(opts.invert),
  };

  if (hasRegion) {
    result.regions = opts.region;
  } else {
    result.detectColor = opts.detect;
    result.tolerance = opts.tolerance ? parseInt(opts.tolerance, 10) : 0;
  }

  // Output handling
  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
