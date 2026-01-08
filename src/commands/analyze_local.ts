import { resolve } from "node:path";
import { getImageInfo, type LocalImageInfo } from "../image";
import { renderHuman, renderJson, renderPlain } from "../output";

export interface AnalyzeLocalOptions {
  json?: boolean;
  plain?: boolean;
}

export async function analyzeLocalCommand(
  imageArg: string,
  opts: AnalyzeLocalOptions
) {
  const imagePath = resolve(imageArg);
  const info = await getImageInfo(imagePath);

  if (opts.json) {
    renderJson({
      ok: true,
      info,
    });
    return;
  }

function formatPlain(info: LocalImageInfo): string {
  const lines = [
    `Path: ${info.path}`,
    `MIME: ${info.mime}`,
    `Bytes: ${info.bytes}`,
    `Width: ${info.width}`,
    `Height: ${info.height}`,
    `Aspect Ratio: ${info.aspectRatio.toFixed(2)}`,
    `Megapixels: ${info.megapixels}`,
    `Channels: ${info.channels}`,
    `Has Alpha: ${info.hasAlpha ? "yes" : "no"}`,
  ];

  if (info.density !== undefined) lines.push(`Density: ${info.density}`);
  if (info.orientation !== undefined) lines.push(`Orientation: ${info.orientation}`);
  if (info.colorSpace !== undefined) lines.push(`Color Space: ${info.colorSpace}`);
  if (info.format !== undefined) lines.push(`Format: ${info.format}`);
  if (info.isProgressive !== undefined) lines.push(`Progressive: ${info.isProgressive ? "yes" : "no"}`);

  return lines.join("\n");
}

function formatHuman(info: LocalImageInfo): string {
  const parts = [
    `${info.mime} ${info.width}x${info.height} (${info.aspectRatio.toFixed(2)}:1)`,
    `${(info.bytes / 1024).toFixed(1)}KB`,
    `${info.megapixels}MP`,
    `${info.channels}ch${info.hasAlpha ? "+alpha" : ""}`,
  ];

  if (info.density !== undefined) parts.push(`${info.density} DPI`);
  if (info.colorSpace !== undefined) parts.push(info.colorSpace);
  if (info.format !== undefined) parts.push(info.format);
  if (info.isProgressive !== undefined) parts.push(info.isProgressive ? "progressive" : "non-progressive");

  return parts.join(", ");
}

  if (opts.plain) {
    renderPlain(formatPlain(info));
    return;
  }

  renderHuman(formatHuman(info));
}
