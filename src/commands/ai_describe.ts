import { resolve, isAbsolute } from "node:path";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload } from "../image";
import { requestCompletion } from "../openrouter";
import { loadAiPromptWithVars } from "../ai-prompts";
import { AuthError, FilesystemError, UsageError } from "../errors";
import { renderJson, renderPlain } from "../output";

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

export interface AiDescribeOptions {
  detail?: string;
  focus?: string;
  output?: string;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  model?: string;
  apiKeyFile?: string;
  apiKeyStdin?: boolean;
  timeout?: string;
}

const VALID_DETAIL_LEVELS = ["brief", "standard", "detailed"];
const VALID_FOCUS_OPTIONS = ["composition", "colors", "objects", "text", "all"];

export async function aiDescribeCommand(image: string, opts: AiDescribeOptions) {
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

  // Validate detail level
  const detail = opts.detail || "standard";
  if (!VALID_DETAIL_LEVELS.includes(detail)) {
    throw new UsageError(`Invalid --detail: ${detail}`, [
      `Valid levels: ${VALID_DETAIL_LEVELS.join(", ")}`,
    ]);
  }

  // Validate focus
  const focus = opts.focus || "all";
  if (!VALID_FOCUS_OPTIONS.includes(focus)) {
    throw new UsageError(`Invalid --focus: ${focus}`, [
      `Valid options: ${VALID_FOCUS_OPTIONS.join(", ")}`,
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
    analyzeModel: opts.model,
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
  const prompt = await loadAiPromptWithVars("describe", {
    detail,
    focus,
  });

  // Make the request
  const requestStart = Date.now();
  let description: string;

  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    description = "MOCK_DESCRIPTION: This is a test image description.";
  } else {
    description = await requestCompletion({
      apiKey: config.apiKey,
      model: config.analyzeModel || config.model || DEFAULT_MODEL,
      prompt,
      mimeType: prepared.mimeType,
      imageBase64: prepared.imageBase64,
      timeoutMs: config.timeoutMs,
    });
  }

  const requestMs = Date.now() - requestStart;
  const totalMs = Date.now() - startTime;

  // Write to file if output specified
  if (opts.output) {
    const outputPath = isAbsolute(opts.output) ? opts.output : resolve(process.cwd(), opts.output);
    await Bun.write(outputPath, description);
  }

  const result = {
    ok: true,
    description,
    source: imagePath,
    model: config.analyzeModel || config.model || DEFAULT_MODEL,
    detail,
    focus,
    outputPath: opts.output ? (isAbsolute(opts.output) ? opts.output : resolve(process.cwd(), opts.output)) : undefined,
    timingMs: {
      total: totalMs,
      uploadPrep: uploadPrepMs,
      request: requestMs,
    },
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(description);
  } else if (!opts.quiet) {
    renderPlain(description);
  }
}
