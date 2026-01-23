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
  bgColor?: string;
  bgLinear?: string;
  bgRadial?: string;
  text?: string;
  textColor?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontSize?: string;
  padding?: string;
  textOutline?: boolean;
  textOutlineColor?: string;
  textOutlineWidth?: string;
  textShadow?: boolean;
  textShadowColor?: string;
  textShadowDx?: string;
  textShadowDy?: string;
  textShadowBlur?: string;
  textShadowOpacity?: string;
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

interface BgLinearSpec {
  colors: [string, string];
  angleDeg: number;
}

interface BgRadialSpec {
  colors: [string, string];
  cx: string;
  cy: string;
  r: string;
  center: { x: number; y: number };
  radius: number;
}

type BackgroundSpec =
  | { type: "solid"; color: string }
  | { type: "linear"; spec: BgLinearSpec }
  | { type: "radial"; spec: BgRadialSpec };

interface TextEffectsConfig {
  outline: {
    enabled: boolean;
    color: string;
    width: number;
  };
  shadow: {
    enabled: boolean;
    color: string;
    dx: number;
    dy: number;
    blur: number;
    opacity: number;
  };
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

function oppositeTextColor(color: string): string {
  return color.toLowerCase() === "#ffffff" ? "#000000" : "#ffffff";
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function parseNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`Invalid ${label}: "${value}"`);
  }
  return parsed;
}

function parseLength(value: string, label: string): { raw: string; value: number; unit: "px" | "percent" } {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const numeric = parseNumber(trimmed.slice(0, -1), label);
    return { raw: `${numeric}%`, value: numeric, unit: "percent" };
  }
  const numeric = parseNumber(trimmed, label);
  return { raw: `${numeric}`, value: numeric, unit: "px" };
}

function parseBgLinearSpec(spec: string): BgLinearSpec {
  const parts = spec.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) {
    throw new UsageError(`Invalid --bg-linear value: "${spec}"`, [
      'Expected format: "<hex1>,<hex2>,<angleDeg>"',
    ]);
  }
  parseHexColor(parts[0]);
  parseHexColor(parts[1]);
  const angle = parseNumber(parts[2], "angle");
  return {
    colors: [parts[0], parts[1]],
    angleDeg: normalizeAngle(angle),
  };
}

function parseBgRadialSpec(
  spec: string,
  width: number,
  height: number
): BgRadialSpec {
  const parts = spec.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) {
    throw new UsageError(`Invalid --bg-radial value: "${spec}"`, [
      'Expected format: "<innerHex>,<outerHex>[,<cx>,<cy>,<r>]"',
    ]);
  }

  const [inner, outer, cxRaw = "50%", cyRaw = "50%", rRaw = "75%"] = parts;
  parseHexColor(inner);
  parseHexColor(outer);

  const cx = parseLength(cxRaw, "radial cx");
  const cy = parseLength(cyRaw, "radial cy");
  const r = parseLength(rRaw, "radial r");

  const center = {
    x: cx.unit === "percent" ? (cx.value / 100) * width : cx.value,
    y: cy.unit === "percent" ? (cy.value / 100) * height : cy.value,
  };
  const radius = r.unit === "percent"
    ? (r.value / 100) * Math.min(width, height)
    : r.value;

  return {
    colors: [inner, outer],
    cx: cx.raw,
    cy: cy.raw,
    r: r.raw,
    center,
    radius,
  };
}

function interpolateColor(a: ParsedColor, b: ParsedColor, t: number): ParsedColor {
  const clamped = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * clamped),
    g: Math.round(a.g + (b.g - a.g) * clamped),
    b: Math.round(a.b + (b.b - a.b) * clamped),
    alpha: a.alpha + (b.alpha - a.alpha) * clamped,
  };
}

function sampleLinearGradient(spec: BgLinearSpec, point: { x: number; y: number }): ParsedColor {
  const angleRad = (spec.angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const dx = point.x - 0.5;
  const dy = point.y - 0.5;
  const t = clamp(0.5 + dx * dir.x + dy * dir.y, 0, 1);
  const start = parseHexColor(spec.colors[0]);
  const end = parseHexColor(spec.colors[1]);
  return interpolateColor(start, end, t);
}

function sampleRadialGradient(spec: BgRadialSpec, point: { x: number; y: number }, width: number, height: number): ParsedColor {
  const px = point.x * width;
  const py = point.y * height;
  const dx = px - spec.center.x;
  const dy = py - spec.center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const t = spec.radius > 0 ? clamp(dist / spec.radius, 0, 1) : 1;
  const start = parseHexColor(spec.colors[0]);
  const end = parseHexColor(spec.colors[1]);
  return interpolateColor(start, end, t);
}

function autoTextColorForGradient(
  background: BackgroundSpec,
  width: number,
  height: number
): string {
  if (background.type === "solid") {
    return autoTextColor(parseHexColor(background.color));
  }

  const samplePoints = [
    { x: 0.5, y: 0.5 },
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.05, y: 0.95 },
    { x: 0.95, y: 0.95 },
  ];

  const samples = samplePoints.map((point) => {
    if (background.type === "linear") {
      return sampleLinearGradient(background.spec, point);
    }
    return sampleRadialGradient(background.spec, point, width, height);
  });

  const whiteLum = relativeLuminance({ r: 255, g: 255, b: 255, alpha: 1 });
  const blackLum = relativeLuminance({ r: 0, g: 0, b: 0, alpha: 1 });

  const whiteWorst = Math.min(
    ...samples.map((sample) => contrastRatio(whiteLum, relativeLuminance(sample)))
  );
  const blackWorst = Math.min(
    ...samples.map((sample) => contrastRatio(blackLum, relativeLuminance(sample)))
  );

  return whiteWorst > blackWorst ? "#ffffff" : "#000000";
}

function colorToSvg(color: ParsedColor): { value: string; opacity?: number } {
  return {
    value: `rgb(${color.r}, ${color.g}, ${color.b})`,
    opacity: color.alpha < 1 ? color.alpha : undefined,
  };
}

function buildBackgroundSvg(width: number, height: number, background: BackgroundSpec): string {
  if (background.type === "solid") {
    const parsed = parseHexColor(background.color);
    const svgColor = colorToSvg(parsed);
    const opacityAttr = svgColor.opacity !== undefined ? ` fill-opacity="${svgColor.opacity}"` : "";
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${svgColor.value}"${opacityAttr} />
</svg>`;
  }

  if (background.type === "linear") {
    const [startHex, endHex] = background.spec.colors;
    const start = colorToSvg(parseHexColor(startHex));
    const end = colorToSvg(parseHexColor(endHex));
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${background.spec.angleDeg}, 0.5, 0.5)">
      <stop offset="0%" stop-color="${start.value}"${start.opacity !== undefined ? ` stop-opacity="${start.opacity}"` : ""} />
      <stop offset="100%" stop-color="${end.value}"${end.opacity !== undefined ? ` stop-opacity="${end.opacity}"` : ""} />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
</svg>`;
  }

  const [innerHex, outerHex] = background.spec.colors;
  const inner = colorToSvg(parseHexColor(innerHex));
  const outer = colorToSvg(parseHexColor(outerHex));
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="${background.spec.cx}" cy="${background.spec.cy}" r="${background.spec.r}">
      <stop offset="0%" stop-color="${inner.value}"${inner.opacity !== undefined ? ` stop-opacity="${inner.opacity}"` : ""} />
      <stop offset="100%" stop-color="${outer.value}"${outer.opacity !== undefined ? ` stop-opacity="${outer.opacity}"` : ""} />
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
</svg>`;
}

function formatBackgroundLabel(background: BackgroundSpec): string {
  if (background.type === "solid") {
    return background.color;
  }
  if (background.type === "linear") {
    return `${background.spec.colors[0]} -> ${background.spec.colors[1]} @ ${background.spec.angleDeg}deg`;
  }
  return `${background.spec.colors[0]} -> ${background.spec.colors[1]} @ ${background.spec.cx},${background.spec.cy},${background.spec.r}`;
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
  font: FontConfig,
  textEffects: TextEffectsConfig
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

  const textColorParsed = parseHexColor(textColor);
  const textColorSvg = colorToSvg(textColorParsed);
  const outlineColorParsed = parseHexColor(textEffects.outline.color);
  const outlineSvg = colorToSvg(outlineColorParsed);
  const shadowColorParsed = parseHexColor(textEffects.shadow.color);
  const shadowSvg = colorToSvg(shadowColorParsed);

  const fillOpacityAttr = textColorSvg.opacity !== undefined ? ` fill-opacity="${textColorSvg.opacity}"` : "";
  const outlineAttrs = textEffects.outline.enabled
    ? ` stroke="${outlineSvg.value}" stroke-width="${textEffects.outline.width}" paint-order="stroke fill" stroke-linejoin="round"${
        outlineSvg.opacity !== undefined ? ` stroke-opacity="${outlineSvg.opacity}"` : ""
      }`
    : "";
  const shadowFilter = textEffects.shadow.enabled
    ? ` filter="url(#shadow)"`
    : "";

  const shadowOpacity = shadowSvg.opacity !== undefined
    ? shadowSvg.opacity * textEffects.shadow.opacity
    : textEffects.shadow.opacity;

  const defs = textEffects.shadow.enabled
    ? `<defs>
      <filter id="shadow">
        <feDropShadow dx="${textEffects.shadow.dx}" dy="${textEffects.shadow.dy}" stdDeviation="${textEffects.shadow.blur}" flood-color="${shadowSvg.value}" flood-opacity="${shadowOpacity}" />
      </filter>
    </defs>`
    : "";

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${defs}
    <text
      x="50%"
      y="0"
      text-anchor="middle"
      font-family="${escapeXml(font.family)}"
      font-weight="${font.weight}"
      font-size="${font.size}px"
      fill="${textColorSvg.value}"${fillOpacityAttr}${outlineAttrs}${shadowFilter}
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
  background: string;
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
    `Background: ${result.background}`,
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

  const backgroundInputs = [opts.bgColor, opts.bgLinear, opts.bgRadial].filter(Boolean);
  if (backgroundInputs.length === 0) {
    throw new UsageError("Provide one of --bg-color, --bg-linear, or --bg-radial");
  }
  if (backgroundInputs.length > 1) {
    throw new UsageError("Choose only one of --bg-color, --bg-linear, or --bg-radial");
  }

  let background: BackgroundSpec;
  let solidBackground: ParsedColor | null = null;
  if (opts.bgColor) {
    solidBackground = parseHexColor(opts.bgColor);
    background = { type: "solid", color: opts.bgColor };
  } else if (opts.bgLinear) {
    background = { type: "linear", spec: parseBgLinearSpec(opts.bgLinear) };
  } else if (opts.bgRadial) {
    background = { type: "radial", spec: parseBgRadialSpec(opts.bgRadial, width, height) };
  } else {
    throw new UsageError("Provide one of --bg-color, --bg-linear, or --bg-radial");
  }

  // Determine text (default to WxH)
  const rawText = opts.text ?? `${width}x${height}`;
  // Process \n escape sequences into actual newlines
  const text = rawText.replace(/\\n/g, "\n");
  const lines = text.split("\n");

  // Determine text color
  const autoContrastText = autoTextColorForGradient(background, width, height);
  const textColor = opts.textColor ?? autoContrastText;
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

  const textOutlineEnabled = opts.textOutline !== false;
  const textShadowEnabled = opts.textShadow !== false;
  const defaultOutlineWidth = Math.max(1, Math.round(fontSize * 0.08));
  const defaultShadowBlur = Math.max(1, Math.round(fontSize * 0.12));
  const effectColorDefault = autoContrastText.toLowerCase() === textColor.toLowerCase()
    ? oppositeTextColor(autoContrastText)
    : autoContrastText;

  let outlineWidth = opts.textOutlineWidth ? parseNumber(opts.textOutlineWidth, "text outline width") : defaultOutlineWidth;
  if (textOutlineEnabled && outlineWidth <= 0) {
    throw new UsageError(`Invalid text outline width: "${opts.textOutlineWidth}" (expected positive number)`);
  }
  if (!textOutlineEnabled) {
    outlineWidth = 0;
  }

  const outlineColor = opts.textOutlineColor ?? effectColorDefault;
  parseHexColor(outlineColor);

  const shadowDx = opts.textShadowDx ? parseNumber(opts.textShadowDx, "text shadow dx") : 0;
  const shadowDy = opts.textShadowDy ? parseNumber(opts.textShadowDy, "text shadow dy") : 2;
  const shadowBlur = opts.textShadowBlur ? parseNumber(opts.textShadowBlur, "text shadow blur") : defaultShadowBlur;
  const shadowOpacity = opts.textShadowOpacity ? parseNumber(opts.textShadowOpacity, "text shadow opacity") : 0.35;
  if (shadowOpacity < 0 || shadowOpacity > 1) {
    throw new UsageError(`Invalid text shadow opacity: "${opts.textShadowOpacity}" (expected 0..1)`);
  }

  const shadowColor = opts.textShadowColor ?? effectColorDefault;
  parseHexColor(shadowColor);

  const textEffects: TextEffectsConfig = {
    outline: {
      enabled: textOutlineEnabled,
      color: outlineColor,
      width: outlineWidth,
    },
    shadow: {
      enabled: textShadowEnabled,
      color: shadowColor,
      dx: shadowDx,
      dy: shadowDy,
      blur: shadowBlur,
      opacity: shadowOpacity,
    },
  };

  // Auto-shrink to fit within padding
  const shadowPadding = textShadowEnabled
    ? Math.ceil(Math.max(Math.abs(shadowDx), Math.abs(shadowDy)) + shadowBlur)
    : 0;
  const outlinePadding = textOutlineEnabled ? Math.ceil(outlineWidth) : 0;
  const effectivePadding = padding + outlinePadding + shadowPadding;
  const maxTextWidth = width - 2 * effectivePadding;
  const maxTextHeight = height - 2 * effectivePadding;
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

  let pipeline = background.type === "solid"
    ? sharp({
        create: {
          width,
          height,
          channels: 4,
          background: {
            r: solidBackground?.r ?? 0,
            g: solidBackground?.g ?? 0,
            b: solidBackground?.b ?? 0,
            alpha: solidBackground?.alpha ?? 1,
          },
        },
      })
    : sharp(Buffer.from(buildBackgroundSvg(width, height, background)));

  // Build SVG text overlay
  const fontConfig: FontConfig = {
    family: fontFamily,
    weight: fontWeight,
    size: finalFontSize,
  };

  const svg = buildTextSvg(width, height, lines, textColor, fontConfig, textEffects);
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
    const flattenColor = background.type === "solid" && solidBackground
      ? solidBackground
      : background.type === "linear"
      ? sampleLinearGradient(background.spec, { x: 0.5, y: 0.5 })
      : sampleRadialGradient(background.spec, { x: 0.5, y: 0.5 }, width, height);
    outputBytes = await pipeline
      .flatten({ background: { r: flattenColor.r, g: flattenColor.g, b: flattenColor.b } })
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
    bgcolor: background.type === "solid" ? background.color : undefined,
    background: background.type === "solid"
      ? { type: "solid", color: background.color }
      : background.type === "linear"
      ? { type: "linear", colors: background.spec.colors, angleDeg: background.spec.angleDeg }
      : {
          type: "radial",
          colors: background.spec.colors,
          cx: background.spec.cx,
          cy: background.spec.cy,
          r: background.spec.r,
        },
    text: rawText,
    textColor,
    font: {
      family: fontFamily,
      weight: fontWeight,
      size: finalFontSize,
    },
    textEffects: {
      outline: {
        enabled: textEffects.outline.enabled,
        color: textEffects.outline.color,
        width: textEffects.outline.width,
      },
      shadow: {
        enabled: textEffects.shadow.enabled,
        color: textEffects.shadow.color,
        dx: textEffects.shadow.dx,
        dy: textEffects.shadow.dy,
        blur: textEffects.shadow.blur,
        opacity: textEffects.shadow.opacity,
      },
    },
    fitting: {
      padding,
      effectivePadding,
      minFontSize,
      finalFontSize,
    },
  };

  // Output handling
  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain({
      outPath: result.outPath,
      mime: result.mime,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      background: formatBackgroundLabel(background),
      text: result.text,
      textColor: result.textColor,
      font: result.font,
    }));
  } else if (!opts.quiet) {
    renderPlain(formatPlain({
      outPath: result.outPath,
      mime: result.mime,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      background: formatBackgroundLabel(background),
      text: result.text,
      textColor: result.textColor,
      font: result.font,
    }));
  }
}
