import { resolve, dirname, isAbsolute, parse } from "node:path";
import { mkdir } from "node:fs/promises";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload } from "../image";
import { requestImageFromPrompt } from "../openrouter";
import { loadAiPromptWithVars } from "../ai-prompts";
import { AuthError, FilesystemError, UsageError } from "../errors";
import { renderJson, renderPlain } from "../output";

const DEFAULT_MODEL = "google/gemini-3-pro-image-preview";

export interface AiVariationsOptions {
  count?: string;
  prompt?: string;
  out: string;
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
  outPaths: string[];
  model: string;
  source: string;
  count: number;
}) {
  const lines = [
    `Model: ${result.model}`,
    `Source: ${result.source}`,
    `Count: ${result.count}`,
    `Outputs:`,
  ];
  for (const path of result.outPaths) {
    lines.push(`  - ${path}`);
  }
  return lines.join("\n");
}

async function resolveOutputPath(outPath: string, index: number, force?: boolean) {
  const parsed = parse(outPath);
  const numberedPath = resolve(parsed.dir, `${parsed.name}_${index}${parsed.ext}`);

  if (force) {
    return { path: numberedPath, warned: false };
  }

  if (!(await Bun.file(numberedPath).exists())) {
    return { path: numberedPath, warned: false };
  }

  // Find next available
  let candidateIndex = index + 1;
  while (true) {
    const candidate = resolve(parsed.dir, `${parsed.name}_${candidateIndex}${parsed.ext}`);
    if (!(await Bun.file(candidate).exists())) {
      return { path: candidate, warned: true };
    }
    candidateIndex += 1;
  }
}

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAn8B9nL8rW0AAAAASUVORK5CYII=";

export async function aiVariationsCommand(image: string, opts: AiVariationsOptions) {
  const startTime = Date.now();

  if (!image) {
    throw new UsageError("Missing <image>.", [
      "Provide the path to an image file (png/jpg/webp).",
    ]);
  }

  // Resolve image path
  const imagePath = isAbsolute(image) ? image : resolve(process.cwd(), image);
  const imageFile = Bun.file(imagePath);
  if (!(await imageFile.exists())) {
    throw new FilesystemError(`Image not found: ${imagePath}`);
  }

  // Validate output path
  if (!opts.out) {
    throw new UsageError("Missing --out.", ["Provide --out PATH for the output images."]);
  }

  // Parse count
  const countStr = opts.count || "4";
  const count = parseInt(countStr, 10);
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    throw new UsageError(`Invalid --count: ${countStr}`, [
      "Count must be between 1 and 10.",
    ]);
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
    generateModel: opts.model,
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

  // Load the prompt with template vars
  const promptText = await loadAiPromptWithVars("variations", {
    user_prompt: opts.prompt || "",
  });

  const requestedOutPath = isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out);
  const outDir = dirname(requestedOutPath);
  await mkdir(outDir, { recursive: true });

  const outPaths: string[] = [];
  const outputs: { path: string; mime: string; bytes: number }[] = [];
  let requestMs = 0;

  for (let i = 1; i <= count; i++) {
    const resolvedOut = await resolveOutputPath(requestedOutPath, i, opts.force);

    if (resolvedOut.warned && !opts.quiet) {
      process.stderr.write(`warning: Output ${i} already exists, saving as: ${resolvedOut.path}\n`);
    }

    const requestStart = Date.now();
    let outputBytes: Buffer;
    let outputMime = "image/png";

    if (process.env.EIKON_MOCK_OPENROUTER === "1") {
      outputBytes = Buffer.from(MOCK_PNG_BASE64, "base64");
      outputMime = "image/png";
    } else {
      const response = await requestImageFromPrompt({
        apiKey: config.apiKey,
        model: config.generateModel || config.model || DEFAULT_MODEL,
        prompt: promptText,
        refs: [{ mimeType: prepared.mimeType, imageBase64: prepared.imageBase64 }],
        timeoutMs: config.timeoutMs,
      });
      outputBytes = response.bytes;
      outputMime = response.mimeType;
    }

    requestMs += Date.now() - requestStart;

    await Bun.write(resolvedOut.path, outputBytes);
    outPaths.push(resolvedOut.path);
    outputs.push({ path: resolvedOut.path, mime: outputMime, bytes: outputBytes.length });
  }

  const totalMs = Date.now() - startTime;

  const result = {
    ok: true,
    outPaths,
    outputs,
    model: config.generateModel || config.model || DEFAULT_MODEL,
    source: imagePath,
    count,
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
