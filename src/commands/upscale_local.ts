import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { getImageInfo, loadSharp } from "../image";
import { resolveResizeTarget } from "../resize";
import { FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface UpscaleLocalOptions {
  out: string;
  scale?: string;
  width?: string;
  height?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
}) {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
  ].join("\n");
}

export async function upscaleLocalCommand(imageArg: string, opts: UpscaleLocalOptions) {
  const imagePath = resolve(imageArg);
  const info = await getImageInfo(imagePath);

  const target = resolveResizeTarget(
    { width: info.width, height: info.height },
    { scale: opts.scale, width: opts.width, height: opts.height }
  );

  const outPath = resolve(opts.out);
  const outFile = Bun.file(outPath);
  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, ["Pass --force to overwrite."]);
  }

  const sharp = await loadSharp();
  const pipeline = sharp(imagePath)
    .rotate()
    .resize({
      width: target.width,
      height: target.height,
      fit: "fill",
      withoutEnlargement: false,
    });

  let outputBytes: Buffer;
  if (info.mime === "image/png") {
    outputBytes = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (info.mime === "image/webp") {
    outputBytes = await pipeline.webp({ lossless: true }).toBuffer();
  } else if (info.mime === "image/jpeg") {
    outputBytes = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  } else {
    outputBytes = await pipeline.toBuffer();
  }

  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  const result = {
    ok: true,
    outPath,
    mime: info.mime,
    bytes: outputBytes.length,
    width: target.width,
    height: target.height,
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
