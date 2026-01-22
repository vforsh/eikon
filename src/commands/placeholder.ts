import { resolve, dirname, extname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadSharp } from "../image";
import { UsageError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface PlaceholderOptions {
  out: string;
  width?: string;
  height?: string;
  w?: string;
  h?: string;
  bgColor: string;
  text?: string;
  textColor?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontSize?: string;
  padding?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

interface FontConfig {
  family: string;
  weight: string;
  size: number;
}

/**
 * Parse hex color string to RGBA components
 * Supports: #RGB, #RRGGBB, #RRGGBBAA
 */
function parseHexColor(color: string): ParsedColor {
  const hex = color.startsWith("#") ? color.slice(1) : color;

  let r: number, g: number, b: number, alpha = 1;

  if (hex.length === 3) {
    // #RGB
    const rHex = hex.charAt(0);
    const gHex = hex.charAt(1);
    const bHex = hex.charAt(2);
    r = parseInt(rHex + rHex, 16);
    g = parseInt(gHex + gHex, 16);
    b = parseInt(bHex + bHex, 16);
  } else if (hex.length === 6) {
    // #RRGGBB
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (hex.length === 8) {
    // #RRGGBBAA
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
 * Convert sRGB to linear RGB for luminance calculation
 */
function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Calculate relative luminance (WCAG formula)
 */
function relativeLuminance(color: ParsedColor): number {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors (WCAG formula)
 */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Choose black or white text color based on background for best contrast
 */
function autoTextColor(bgColor: ParsedColor): string {
  const bgLum = relativeLuminance(bgColor);
  const whiteLum = relativeLuminance({ r: 255, g: 255, b: 255, alpha: 1 });
  const blackLum = relativeLuminance({ r: 0, g: 0, b: 0, alpha: 1 });

  const whiteContrast = contrastRatio(whiteLum, bgLum);
  const blackContrast = contrastRatio(blackLum, bgLum);

  return whiteContrast > blackContrast ? "#ffffff" : "#000000";
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
 * Escape text for safe SVG inclusion
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Estimate text dimensions using heuristics (no external deps)
 * Returns { width, height } in pixels
 */
function estimateTextSize(
  lines: string[],
  fontSize: number,
  lineHeight: number = 1.2
): { width: number; height: number } {
  const maxLineLength = Math.max(...lines.map((l) => l.length));
  // Approximate character width as 0.6 * fontSize (monospace-ish estimate)
  const width = maxLineLength * fontSize * 0.6;
  const height = lines.length * fontSize * lineHeight;
  return { width, height };
}

/**
 * Build SVG for text overlay with optional embedded font
 */
function buildTextSvg(
  width: number,
  height: number,
  lines: string[],
  textColor: string,
  font: FontConfig
): string {
  const lineHeight = 1.2;
  const totalTextHeight = lines.length * font.size * lineHeight;

  // Calculate starting Y to center the text block vertically
  // First line baseline offset from center
  const startY = (height - totalTextHeight) / 2 + font.size * 0.85;

  const tspans = lines
    .map((line, i) => {
      const dy = i === 0 ? startY : font.size * lineHeight;
      return `<tspan x="50%" dy="${i === 0 ? startY : font.size * lineHeight}">${escapeXml(line)}</tspan>`;
    })
    .join("\n      ");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text
      x="50%"
      y="0"
      text-anchor="middle"
      font-family="${escapeXml(font.family)}"
      font-weight="${font.weight}"
      font-size="${font.size}px"
      fill="${escapeXml(textColor)}"
    >
      ${tspans}
    </text>
  </svg>`;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  bgcolor: string;
  text: string;
  textColor: string;
  font: { family: string; weight: string; size: number };
}): string {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Background: ${result.bgcolor}`,
    `Text: ${result.text}`,
    `Text Color: ${result.textColor}`,
    `Font: ${result.font.family} ${result.font.weight} ${result.font.size}px`,
  ].join("\n");
}

export async function placeholderCommand(opts: PlaceholderOptions) {
  // Resolve dimension aliases (--w/--h to --width/--height)
  const widthStr = opts.width ?? opts.w;
  const heightStr = opts.height ?? opts.h;

  // Check for conflicting aliases
  if (opts.width && opts.w && opts.width !== opts.w) {
    throw new UsageError("Conflicting values for --width and --w");
  }
  if (opts.height && opts.h && opts.height !== opts.h) {
    throw new UsageError("Conflicting values for --height and --h");
  }

  // Validate required options
  if (!widthStr) {
    throw new UsageError("Missing required option: --width (or --w)");
  }
  if (!heightStr) {
    throw new UsageError("Missing required option: --height (or --h)");
  }

  // Parse dimensions
  const width = parseInt(widthStr, 10);
  const height = parseInt(heightStr, 10);

  if (!Number.isInteger(width) || width <= 0) {
    throw new UsageError(`Invalid width: "${widthStr}" (expected positive integer)`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new UsageError(`Invalid height: "${heightStr}" (expected positive integer)`);
  }

  // Parse background color
  const bgColor = parseHexColor(opts.bgColor);
  const bgColorStr = opts.bgColor;

  // Determine text (default to WxH)
  const rawText = opts.text ?? `${width}x${height}`;
  // Process \n escape sequences into actual newlines
  const text = rawText.replace(/\\n/g, "\n");
  const lines = text.split("\n");

  // Determine text color
  const textColor = opts.textColor ?? autoTextColor(bgColor);
  // Validate text color if provided
  if (opts.textColor) {
    parseHexColor(opts.textColor);
  }

  // Parse padding
  const padding = opts.padding ? parseInt(opts.padding, 10) : 24;
  if (!Number.isInteger(padding) || padding < 0) {
    throw new UsageError(`Invalid padding: "${opts.padding}" (expected non-negative integer)`);
  }

  // Font configuration
  let fontFamily = opts.fontFamily ?? "sans-serif";
  let fontWeight = opts.fontWeight ?? "normal";

  // Validate font weight
  const validWeights = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
  if (!validWeights.includes(fontWeight)) {
    throw new UsageError(`Invalid font weight: "${fontWeight}"`, [
      "Valid values: normal, bold, 100-900",
    ]);
  }

  // Determine initial font size
  const minFontSize = 8;
  let fontSize = opts.fontSize
    ? parseInt(opts.fontSize, 10)
    : Math.floor(Math.min(width, height) / 6);

  if (opts.fontSize && (!Number.isInteger(fontSize) || fontSize <= 0)) {
    throw new UsageError(`Invalid font size: "${opts.fontSize}" (expected positive integer)`);
  }

  // Auto-shrink to fit within padding
  const maxTextWidth = width - 2 * padding;
  const maxTextHeight = height - 2 * padding;
  const lineHeight = 1.2;

  // Shrink font until text fits or we hit minimum
  let estimated = estimateTextSize(lines, fontSize, lineHeight);
  while (
    (estimated.width > maxTextWidth || estimated.height > maxTextHeight) &&
    fontSize > minFontSize
  ) {
    fontSize = Math.max(minFontSize, Math.floor(fontSize * 0.9));
    estimated = estimateTextSize(lines, fontSize, lineHeight);
  }

  const finalFontSize = fontSize;

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

  // Create base image with solid background
  const rgbaBackground = {
    r: bgColor.r,
    g: bgColor.g,
    b: bgColor.b,
    alpha: bgColor.alpha,
  };

  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: rgbaBackground,
    },
  });

  // Build SVG text overlay
  const fontConfig: FontConfig = {
    family: fontFamily,
    weight: fontWeight,
    size: finalFontSize,
  };

  const svg = buildTextSvg(width, height, lines, textColor, fontConfig);
  const svgBuffer = Buffer.from(svg);

  // Composite SVG onto base
  pipeline = pipeline.composite([{ input: svgBuffer, top: 0, left: 0 }]);

  // Encode based on output format
  let outputBytes: Buffer;
  if (mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (mime === "image/jpeg") {
    // JPEG doesn't support alpha, flatten with background
    outputBytes = await pipeline
      .flatten({ background: { r: bgColor.r, g: bgColor.g, b: bgColor.b } })
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
    width,
    height,
    bgcolor: bgColorStr,
    text: rawText,
    textColor,
    font: {
      family: fontFamily,
      weight: fontWeight,
      size: finalFontSize,
    },
    fitting: {
      padding,
      minFontSize,
      finalFontSize,
    },
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
