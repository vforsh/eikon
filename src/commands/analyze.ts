import { resolve } from "node:path";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload } from "../image";
import { requestCompletion } from "../openrouter";
import { loadPresetPrompt, SUPPORTED_PRESETS } from "../presets";
import { handleOutputPolicy } from "../output";
import type { AnalysisResult } from "../output";
import { UsageError, AuthError } from "../errors";

export interface AnalyzeOptions {
  model?: string;
  preset?: string;
  promptStdin?: boolean;
  plain?: boolean;
  json?: boolean;
  output?: string;
  quiet?: boolean;
  verbose?: boolean;
  debug?: boolean;
  noColor?: boolean;
  apiKeyFile?: string;
  apiKeyStdin?: boolean;
  downsize?: boolean;
  maxWidth?: string;
  maxHeight?: string;
  timeout?: string;
}

export async function analyzeCommand(
  imageArg: string,
  promptParts: string[] | undefined,
  opts: AnalyzeOptions
) {
  const startTime = Date.now();
  const imagePath = resolve(imageArg);

  // Auth resolution
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
      "Or pass --api-key-file PATH / --api-key-stdin"
    ]);
  }

  // Prompt resolution
  let prompt = (promptParts || []).join(" ").trim();
  if (opts.promptStdin) {
    const stdinPrompt = (await Bun.stdin.text()).trim();
    prompt = prompt ? `${prompt}\n${stdinPrompt}` : stdinPrompt;
  }
  
  if (opts.preset) {
    const presetPrompt = await loadPresetPrompt(opts.preset);
    prompt = prompt ? `${presetPrompt}\n\nAdditional context from user:\n${prompt}` : presetPrompt;
  }

  if (!prompt) {
    throw new UsageError("Missing prompt. Provide [prompt...], --preset, or --prompt-stdin.", [
      `Supported presets: ${SUPPORTED_PRESETS.join(", ")}`
    ]);
  }

  // Image preparation
  const prepStartTime = Date.now();
  const processedImage = await prepareImageForUpload({
    imagePath,
    downsize: opts.downsize,
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
  });
  const uploadPrepMs = Date.now() - prepStartTime;

  // Request
  const requestStartTime = Date.now();
  let text: string;

  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    if (process.env.EIKON_TEST_IMAGE_INFO === "1") {
      const bytes = Buffer.from(processedImage.imageBase64, "base64");
      text = `size:${bytes.length},mime:${processedImage.mimeType}`;
      if (processedImage.processed) {
        text += `,w:${processedImage.processed.width},h:${processedImage.processed.height}`;
      }
    } else {
      text = "EIKON_E2E_MOCK_RESPONSE";
    }
  } else {
    text = await requestCompletion({
      apiKey: config.apiKey,
      model: config.analyzeModel || config.model || "google/gemini-3-flash-preview",
      prompt,
      mimeType: processedImage.mimeType,
      imageBase64: processedImage.imageBase64,
      timeoutMs: config.timeoutMs,
    });
  }
  const requestMs = Date.now() - requestStartTime;
  const totalMs = Date.now() - startTime;

  const result: AnalysisResult = {
    ok: true,
    text,
    meta: {
      model: config.analyzeModel || config.model || "google/gemini-3-flash-preview",
      preset: opts.preset,
      image: {
        path: imagePath,
        mime: processedImage.mimeType,
        original: processedImage.original,
        processed: processedImage.processed,
      },
      timingMs: {
        total: totalMs,
        uploadPrep: uploadPrepMs,
        request: requestMs,
      },
    },
  };

  await handleOutputPolicy(result, opts);
}
