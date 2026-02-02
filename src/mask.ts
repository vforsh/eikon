import { UsageError } from "./errors";

export type MaskSpec =
  | { type: "none" }
  | { type: "circle" }
  | { type: "rounded"; radius: number }
  | { type: "squircle"; radius: number };

/**
 * Parse mask specification string
 * Accepts: "circle", "rounded", "rounded:<px>", "rounded:<n>%", "squircle", "squircle:<px>", "squircle:<n>%"
 */
export function parseMaskSpec(spec: string | undefined, width: number, height: number): MaskSpec {
  if (!spec) {
    return { type: "none" };
  }

  const trimmed = spec.trim().toLowerCase();

  if (trimmed === "circle") {
    return { type: "circle" };
  }

  if (trimmed === "rounded") {
    const radius = Math.min(width, height) * 0.1;
    return { type: "rounded", radius };
  }

  if (trimmed === "squircle") {
    const radius = Math.min(width, height) * 0.1;
    return { type: "squircle", radius };
  }

  if (trimmed.startsWith("rounded:")) {
    const radiusStr = trimmed.slice("rounded:".length).trim();
    if (radiusStr.endsWith("%")) {
      const percent = parseFloat(radiusStr.slice(0, -1));
      if (!Number.isFinite(percent) || percent < 0) {
        throw new UsageError(`Invalid mask radius percentage: "${radiusStr}"`, [
          'Expected format: "rounded:<n>%"',
        ]);
      }
      const radius = Math.min(width, height) * (percent / 100);
      return { type: "rounded", radius };
    }

    const radius = parseFloat(radiusStr);
    if (!Number.isFinite(radius) || radius < 0) {
      throw new UsageError(`Invalid mask radius: "${radiusStr}"`, [
        'Expected format: "rounded:<px>" or "rounded:<n>%"',
      ]);
    }
    return { type: "rounded", radius };
  }

  if (trimmed.startsWith("squircle:")) {
    const radiusStr = trimmed.slice("squircle:".length).trim();
    if (radiusStr.endsWith("%")) {
      const percent = parseFloat(radiusStr.slice(0, -1));
      if (!Number.isFinite(percent) || percent < 0) {
        throw new UsageError(`Invalid mask radius percentage: "${radiusStr}"`, [
          'Expected format: "squircle:<n>%"',
        ]);
      }
      const radius = Math.min(width, height) * (percent / 100);
      return { type: "squircle", radius };
    }

    const radius = parseFloat(radiusStr);
    if (!Number.isFinite(radius) || radius < 0) {
      throw new UsageError(`Invalid mask radius: "${radiusStr}"`, [
        'Expected format: "squircle:<px>" or "squircle:<n>%"',
      ]);
    }
    return { type: "squircle", radius };
  }

  throw new UsageError(`Invalid mask value: "${spec}"`, [
    'Accepted values: "circle", "rounded", "rounded:<radius>", "squircle", "squircle:<radius>"',
  ]);
}

/**
 * Generate squircle path using superellipse formula
 * Uses n=5 for iOS-style smooth corners
 */
export function buildSquirclePath(width: number, height: number, radius: number): string {
  const n = 5; // Superellipse exponent (4-5 gives nice squircle)
  const r = Math.min(radius, width / 2, height / 2);

  const points: Array<{ x: number; y: number }> = [];
  const stepsPerCorner = 32;

  // Superellipse formula: |x/a|^n + |y/b|^n = 1
  // Parametric: x = a * sign(cos(t)) * |cos(t)|^(2/n)
  //             y = b * sign(sin(t)) * |sin(t)|^(2/n)
  const superellipse = (t: number): { dx: number; dy: number } => {
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return {
      dx: Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n),
      dy: Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n),
    };
  };

  // Trace clockwise starting from top-center, going right

  // Top edge: from (r, 0) to (width - r, 0)
  points.push({ x: r, y: 0 });
  points.push({ x: width - r, y: 0 });

  // Top-right corner: center at (width - r, r)
  // Angle goes from -π/2 (top) to 0 (right) for clockwise
  for (let i = 0; i <= stepsPerCorner; i++) {
    const t = -Math.PI / 2 + (i / stepsPerCorner) * (Math.PI / 2);
    const { dx, dy } = superellipse(t);
    points.push({ x: (width - r) + r * dx, y: r + r * dy });
  }

  // Right edge: from (width, r) to (width, height - r)
  points.push({ x: width, y: r });
  points.push({ x: width, y: height - r });

  // Bottom-right corner: center at (width - r, height - r)
  // Angle goes from 0 (right) to π/2 (bottom)
  for (let i = 0; i <= stepsPerCorner; i++) {
    const t = (i / stepsPerCorner) * (Math.PI / 2);
    const { dx, dy } = superellipse(t);
    points.push({ x: (width - r) + r * dx, y: (height - r) + r * dy });
  }

  // Bottom edge: from (width - r, height) to (r, height)
  points.push({ x: width - r, y: height });
  points.push({ x: r, y: height });

  // Bottom-left corner: center at (r, height - r)
  // Angle goes from π/2 (bottom) to π (left)
  for (let i = 0; i <= stepsPerCorner; i++) {
    const t = Math.PI / 2 + (i / stepsPerCorner) * (Math.PI / 2);
    const { dx, dy } = superellipse(t);
    points.push({ x: r + r * dx, y: (height - r) + r * dy });
  }

  // Left edge: from (0, height - r) to (0, r)
  points.push({ x: 0, y: height - r });
  points.push({ x: 0, y: r });

  // Top-left corner: center at (r, r)
  // Angle goes from π (left) to 3π/2 (top)
  for (let i = 0; i <= stepsPerCorner; i++) {
    const t = Math.PI + (i / stepsPerCorner) * (Math.PI / 2);
    const { dx, dy } = superellipse(t);
    points.push({ x: r + r * dx, y: r + r * dy });
  }

  // Build path
  const pathData = points
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
    .join(" ");

  return pathData + " Z";
}

/**
 * Build SVG mask with white shape on transparent background
 */
export function buildMaskSvg(width: number, height: number, mask: MaskSpec): string {
  if (mask.type === "circle") {
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2;
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
</svg>`;
  }

  if (mask.type === "rounded") {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${mask.radius}" ry="${mask.radius}" fill="white"/>
</svg>`;
  }

  if (mask.type === "squircle") {
    const pathData = buildSquirclePath(width, height, mask.radius);
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="${pathData}" fill="white"/>
</svg>`;
  }

  // mask.type === "none" - should not be called
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" fill="white"/>
</svg>`;
}
