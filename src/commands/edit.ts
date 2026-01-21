import { resolve, dirname, isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload } from "../image";
import { requestImageEditWithPreservation } from "../openrouter";
import { AuthError, FilesystemError, UsageError } from "../errors";
import { renderJson, renderPlain } from "../output";

const DEFAULT_MODEL = "google/gemini-3-pro-image-preview";

export interface EditOptions {
  prompt?: string;
  promptStdin?: boolean;
  out?: string;
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
  model: string;
  source: string;
}) {
  return [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Model: ${result.model}`,
    `Source: ${result.source}`,
  ].join("\n");
}

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAn8B9nL8rW0AAAAASUVORK5CYII=";

export async function editCommand(image: string, opts: EditOptions) {
  const startTime = Date.now();

  // Resolve image path
  const imagePath = isAbsolute(image) ? image : resolve(process.cwd(), image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Get prompt (edit instruction)
  let instruction: string;
  if (opts.promptStdin) {
    instruction = (await Bun.stdin.text()).trim();
  } else if (opts.prompt) {
    instruction = opts.prompt.trim();
  } else {
    throw new UsageError("Missing --prompt.", [
      "Provide --prompt TEXT or --prompt-stdin.",
    ]);
  }

  if (!instruction) {
    throw new UsageError("Prompt cannot be empty.");
  }

  // Validate output path
  if (!opts.out) {
    throw new UsageError("Missing --out.", ["Provide --out PATH for the output image."]);
  }

  const outPath = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);
  const outFile = Bun.file(outPath);

  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, ["Pass --force to overwrite."]);
  }

  // Get API key
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
    editModel: opts.model,
    timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
  });

  if (!config.apiKey) {
    throw new AuthError("Missing API key.", [
      "Set OPENROUTER_API_KEY, or run: eikon config init",
      "Or pass --api-key-file PATH / --api-key-stdin",
    ]);
  }

  // Prepare the image
  const uploadPrepStart = Date.now();
  const prepared = await prepareImageForUpload({ imagePath });
  const uploadPrepMs = Date.now() - uploadPrepStart;

  // Make the request
  const requestStart = Date.now();
  let outputBytes: Buffer;
  let outputMime = "image/png";

  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    outputBytes = Buffer.from(MOCK_PNG_BASE64, "base64");
    outputMime = "image/png";
  } else {
    const response = await requestImageEditWithPreservation({
      apiKey: config.apiKey,
      model: config.editModel || config.model || DEFAULT_MODEL,
      instruction,
      mimeType: prepared.mimeType,
      imageBase64: prepared.imageBase64,
      timeoutMs: config.timeoutMs,
    });
    outputBytes = response.bytes;
    outputMime = response.mimeType;
  }

  const requestMs = Date.now() - requestStart;
  const totalMs = Date.now() - startTime;

  // Write output
  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  const result = {
    ok: true,
    outPath,
    mime: outputMime,
    bytes: outputBytes.length,
    model: config.editModel || config.model || DEFAULT_MODEL,
    source: imagePath,
    timingMs: {
      total: totalMs,
      uploadPrep: uploadPrepMs,
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
