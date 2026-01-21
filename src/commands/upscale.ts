import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload } from "../image";
import { requestImageFromChat } from "../openrouter";
import { resolveResizeTarget } from "../resize";
import { AuthError, FilesystemError } from "../errors";
import { renderJson, renderPlain } from "../output";

export interface UpscaleOptions {
  out: string;
  scale?: string;
  width?: string;
  height?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  model?: string;
  apiKeyFile?: string;
  apiKeyStdin?: boolean;
  timeout?: string;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  model: string;
}) {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Width: ${result.width}`,
    `Height: ${result.height}`,
    `Model: ${result.model}`,
  ].join("\n");
}

export async function upscaleCommand(imageArg: string, opts: UpscaleOptions) {
  const startTime = Date.now();
  const imagePath = resolve(imageArg);

  let apiKey: string | undefined;
  if (opts.apiKeyStdin) {
    apiKey = (await Bun.stdin.text()).trim();
  } else if (opts.apiKeyFile) {
    const file = Bun.file(opts.apiKeyFile);
    if (await file.exists()) {
      apiKey = (await file.text()).trim();
    } else {
      throw new AuthError(`API key file not found: ${opts.apiKeyFile}`);
    }
  }

  const config = await getEffectiveConfig({
    apiKey,
    upscaleModel: opts.model,
    timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
  });

  if (!config.apiKey) {
    throw new AuthError("Missing API key.", [
      "Set OPENROUTER_API_KEY, or run: eikon config init",
      "Or pass --api-key-file PATH / --api-key-stdin"
    ]);
  }

  const outPath = resolve(opts.out);
  const outFile = Bun.file(outPath);
  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, ["Pass --force to overwrite."]);
  }

  const processed = await prepareImageForUpload({ imagePath });
  const original = processed.original;
  if (!original) {
    throw new FilesystemError("Failed to read image dimensions.");
  }

  const target = resolveResizeTarget(
    { width: original.width, height: original.height },
    { scale: opts.scale, width: opts.width, height: opts.height }
  );

  const prompt =
    `Upscale to ${target.width}x${target.height} (scale ${target.scale.toFixed(2)}x). ` +
    "Preserve content. No style change.";

  let outputBytes: Buffer;
  const requestStart = Date.now();
  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    outputBytes = Buffer.from(processed.imageBase64, "base64");
  } else {
    outputBytes = await requestImageFromChat({
      apiKey: config.apiKey,
      model: config.upscaleModel || config.model || "google/gemini-2.5-flash-image",
      prompt,
      mimeType: processed.mimeType,
      imageBase64: processed.imageBase64,
      timeoutMs: config.timeoutMs,
    });
  }
  const requestMs = Date.now() - requestStart;
  const totalMs = Date.now() - startTime;

  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  const result = {
    ok: true,
    outPath,
    mime: processed.mimeType,
    width: target.width,
    height: target.height,
    bytes: outputBytes.length,
    model: config.upscaleModel || config.model || "google/gemini-2.5-flash-image",
    timingMs: {
      total: totalMs,
      request: requestMs,
    },
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
