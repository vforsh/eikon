import { OpenRouter } from "@openrouter/sdk";
import type {
  ChatMessageContentItem,
  ChatResponse,
  Model,
} from "@openrouter/sdk/models";
import { UnauthorizedResponseError } from "@openrouter/sdk/models/errors";
import { AuthError, NetworkError } from "./errors";
import { loadAiPrompt } from "./ai-prompts";

export interface OpenRouterModelSummary {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

export interface OpenRouterModelDetails {
  id: string;
  name?: string;
  contextLength?: number;
  inputModalities: string[];
  outputModalities: string[];
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
  };
}

export interface RequestOptions {
  apiKey: string;
  model: string;
  prompt: string;
  mimeType: string;
  imageBase64: string;
  timeoutMs?: number;
}

export interface ImageEditRequestOptions {
  apiKey: string;
  model: string;
  prompt: string;
  imageBytes: Buffer;
  mimeType: string;
  timeoutMs?: number;
}

function createClient(apiKey: string): OpenRouter {
  return new OpenRouter({ apiKey });
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof UnauthorizedResponseError;
}

function wrapError(error: unknown): never {
  if (isUnauthorizedError(error)) {
    throw new AuthError("Invalid API key provided for OpenRouter.");
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new NetworkError(`OpenRouter API request failed: ${message}`);
}

export async function requestCompletion({
  apiKey,
  model,
  prompt,
  mimeType,
  imageBase64,
  timeoutMs,
}: RequestOptions): Promise<string> {
  const client = createClient(apiKey);

  try {
    const response = await client.chat.send(
      {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                imageUrl: { url: `data:${mimeType};base64,${imageBase64}` },
              },
            ],
          },
        ],
      },
      { timeoutMs }
    );

    const text = response.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string") {
      throw new NetworkError("No response content received from the model.");
    }

    return text;
  } catch (error) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    wrapError(error);
  }
}

export async function requestImageEdit({
  apiKey,
  model,
  prompt,
  imageBytes,
  mimeType,
  timeoutMs,
}: ImageEditRequestOptions): Promise<Buffer> {
  // The SDK doesn't have an images.edit endpoint, so we still need to use fetch directly
  // or fall back to using OpenAI SDK for this specific endpoint
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 120000);

  try {
    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", prompt);
    formData.append("image", new Blob([imageBytes], { type: mimeType }), "input");

    const response = await fetch("https://openrouter.ai/api/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new AuthError("Invalid API key provided for OpenRouter.");
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new NetworkError(`OpenRouter API request failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json: any = await response.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      throw new NetworkError("No image data received from the model.");
    }
    return Buffer.from(b64, "base64");
  } catch (error: any) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new NetworkError("OpenRouter API request timed out.");
    }
    wrapError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    throw new NetworkError("Unexpected image data URL format from the model.");
  }
  const base64 = match[2];
  if (!base64) {
    throw new NetworkError("Unexpected image data URL format from the model.");
  }
  return Buffer.from(base64, "base64");
}

export async function requestImageFromChat({
  apiKey,
  model,
  prompt,
  mimeType,
  imageBase64,
  timeoutMs,
}: RequestOptions): Promise<Buffer> {
  const client = createClient(apiKey);

  try {
    const response = (await client.chat.send(
      {
        model,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                imageUrl: { url: `data:${mimeType};base64,${imageBase64}` },
              },
            ],
          },
        ],
      },
      { timeoutMs }
    )) as ChatResponse;

    const message = response.choices?.[0]?.message;
    const imageUrl: string | undefined = (message as any)?.images?.[0]?.imageUrl?.url;
    if (!imageUrl) {
      throw new NetworkError("No image data received from the model.");
    }
    if (imageUrl.startsWith("data:")) {
      return decodeDataUrl(imageUrl);
    }
    throw new NetworkError("Model returned a non-data URL image.");
  } catch (error) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    wrapError(error);
  }
}

export async function requestImageFromPrompt({
  apiKey,
  model,
  prompt,
  refs,
  timeoutMs,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  refs?: { mimeType: string; imageBase64: string }[];
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const client = createClient(apiKey);

  const content: ChatMessageContentItem[] = [{ type: "text", text: prompt }];
  if (refs && refs.length > 0) {
    for (const ref of refs) {
      content.push({
        type: "image_url",
        imageUrl: { url: `data:${ref.mimeType};base64,${ref.imageBase64}` },
      });
    }
  }

  try {
    const response = (await client.chat.send(
      {
        model,
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content,
          },
        ],
      },
      { timeoutMs }
    )) as ChatResponse;

    const message = response.choices?.[0]?.message;
    const imageUrl: string | undefined = (message as any)?.images?.[0]?.imageUrl?.url;
    if (!imageUrl) {
      throw new NetworkError("No image data received from the model.");
    }

    if (!imageUrl.startsWith("data:")) {
      throw new NetworkError("Model returned a non-data URL image.");
    }

    const match = /^data:([^;]+);base64,(.*)$/.exec(imageUrl);
    if (!match) {
      throw new NetworkError("Unexpected image data URL format from the model.");
    }

    const mime = match[1];
    const base64 = match[2];
    if (!mime || !base64) {
      throw new NetworkError("Unexpected image data URL format from the model.");
    }
    return {
      bytes: Buffer.from(base64, "base64"),
      mimeType: mime,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    wrapError(error);
  }
}

async function fetchOpenRouterModels({
  timeoutMs,
}: {
  timeoutMs?: number;
}): Promise<Model[]> {
  // Create a client without auth since /models is public
  const client = new OpenRouter({});

  try {
    const response = await client.models.list({}, { timeoutMs: timeoutMs ?? 30000 });
    return response.data ?? [];
  } catch (error: any) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    if (error?.name === "RequestTimeoutError") {
      throw new NetworkError("OpenRouter /models request timed out.");
    }
    throw new NetworkError(`OpenRouter /models request failed: ${error?.message || String(error)}`);
  }
}

export async function requestImageEditWithPreservation({
  apiKey,
  model,
  instruction,
  mimeType,
  imageBase64,
  timeoutMs,
  systemPrompt,
}: {
  apiKey: string;
  model: string;
  instruction: string;
  mimeType: string;
  imageBase64: string;
  timeoutMs?: number;
  systemPrompt?: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const client = createClient(apiKey);

  const effectiveSystemPrompt = systemPrompt ?? (await loadAiPrompt("edit-system"));

  try {
    const response = (await client.chat.send(
      {
        model,
        modalities: ["image", "text"],
        messages: [
          {
            role: "system",
            content: effectiveSystemPrompt,
          },
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              {
                type: "image_url",
                imageUrl: { url: `data:${mimeType};base64,${imageBase64}` },
              },
            ],
          },
        ],
      },
      { timeoutMs }
    )) as ChatResponse;

    const message = response.choices?.[0]?.message;
    const imageUrl: string | undefined = (message as any)?.images?.[0]?.imageUrl?.url;
    if (!imageUrl) {
      throw new NetworkError("No image data received from the model.");
    }

    if (!imageUrl.startsWith("data:")) {
      throw new NetworkError("Model returned a non-data URL image.");
    }

    const match = /^data:([^;]+);base64,(.*)$/.exec(imageUrl);
    if (!match) {
      throw new NetworkError("Unexpected image data URL format from the model.");
    }

    const mime = match[1];
    const base64 = match[2];
    if (!mime || !base64) {
      throw new NetworkError("Unexpected image data URL format from the model.");
    }
    return {
      bytes: Buffer.from(base64, "base64"),
      mimeType: mime,
    };
  } catch (error) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    wrapError(error);
  }
}

export async function listImageGenModels({
  supportsRef,
  timeoutMs,
}: {
  supportsRef?: boolean;
  timeoutMs?: number;
}): Promise<string[]> {
  const details = await listImageGenModelDetails({ supportsRef, timeoutMs });
  return details.map((model) => model.id);
}

export async function listImageGenModelDetails({
  supportsRef,
  timeoutMs,
}: {
  supportsRef?: boolean;
  timeoutMs?: number;
}): Promise<OpenRouterModelDetails[]> {
  const models =
    process.env.EIKON_MOCK_OPENROUTER === "1"
      ? getMockModels()
      : await fetchOpenRouterModels({ timeoutMs });

  return filterModelDetails(models, (model) => {
    if (!model.inputModalities.includes("text")) return false;
    if (!model.outputModalities.includes("image")) return false;
    if (supportsRef && !model.inputModalities.includes("image")) return false;
    return true;
  });
}

export async function listImageEditModels({
  timeoutMs,
}: {
  timeoutMs?: number;
}): Promise<string[]> {
  const details = await listImageEditModelDetails({ timeoutMs });
  return details.map((model) => model.id);
}

export async function listImageEditModelDetails({
  timeoutMs,
}: {
  timeoutMs?: number;
}): Promise<OpenRouterModelDetails[]> {
  const models =
    process.env.EIKON_MOCK_OPENROUTER === "1"
      ? getMockModels()
      : await fetchOpenRouterModels({ timeoutMs });

  return filterModelDetails(models, (model) => {
    if (!model.inputModalities.includes("image")) return false;
    if (!model.outputModalities.includes("image")) return false;
    return true;
  });
}

function getMockModels(): Model[] {
  return [
    {
      id: "google/gemini-3-pro-image-preview",
      name: "Gemini 3 Pro Image Preview",
      canonicalSlug: "google/gemini-3-pro-image-preview",
      contextLength: 32768,
      created: 0,
      pricing: {
        prompt: "0.000000",
        completion: "0.000000",
        image: "0.000000",
        request: "0",
      },
      architecture: {
        modality: "multimodal",
        inputModalities: ["text", "image"],
        outputModalities: ["image"],
      },
      topProvider: { maxCompletionTokens: null, isModerated: false },
      perRequestLimits: null,
      supportedParameters: [],
      defaultParameters: null,
    },
    {
      id: "openai/gpt-5-image",
      name: "GPT-5 Image",
      canonicalSlug: "openai/gpt-5-image",
      contextLength: 131072,
      created: 0,
      pricing: {
        prompt: "0.000010",
        completion: "0.000030",
        image: "0.000000",
        request: "0",
      },
      architecture: {
        modality: "multimodal",
        inputModalities: ["text"],
        outputModalities: ["image"],
      },
      topProvider: { maxCompletionTokens: null, isModerated: false },
      perRequestLimits: null,
      supportedParameters: [],
      defaultParameters: null,
    },
    {
      id: "openai/gpt-5-image-mini",
      name: "GPT-5 Image Mini",
      canonicalSlug: "openai/gpt-5-image-mini",
      contextLength: 131072,
      created: 0,
      pricing: {
        prompt: "0.000003",
        completion: "0.000010",
        image: "0.000000",
        request: "0",
      },
      architecture: {
        modality: "multimodal",
        inputModalities: ["text", "image"],
        outputModalities: ["image"],
      },
      topProvider: { maxCompletionTokens: null, isModerated: false },
      perRequestLimits: null,
      supportedParameters: [],
      defaultParameters: null,
    },
    {
      id: "stability/sdxl-edit",
      name: "SDXL Edit",
      canonicalSlug: "stability/sdxl-edit",
      contextLength: 2048,
      created: 0,
      pricing: {
        prompt: "0.000000",
        completion: "0.000000",
        image: "0.000600",
        request: "0",
      },
      architecture: {
        modality: "image",
        inputModalities: ["image"],
        outputModalities: ["image"],
      },
      topProvider: { maxCompletionTokens: null, isModerated: false },
      perRequestLimits: null,
      supportedParameters: [],
      defaultParameters: null,
    },
  ];
}

function toModelDetails(model: Model): OpenRouterModelDetails | null {
  const id = typeof model?.id === "string" ? model.id.trim() : "";
  if (!id) return null;
  const input = model?.architecture?.inputModalities;
  const output = model?.architecture?.outputModalities;
  if (!Array.isArray(input) || !Array.isArray(output)) return null;

  return {
    id,
    name: typeof model?.name === "string" ? model.name : undefined,
    contextLength: typeof model?.contextLength === "number" ? model.contextLength : undefined,
    inputModalities: input,
    outputModalities: output,
    pricing: model?.pricing
      ? {
          prompt: model.pricing.prompt,
          completion: model.pricing.completion,
          request: model.pricing.request,
          image: model.pricing.image,
        }
      : undefined,
  };
}

function filterModelDetails(
  models: Model[],
  predicate: (model: OpenRouterModelDetails) => boolean
): OpenRouterModelDetails[] {
  const entries = new Map<string, OpenRouterModelDetails>();

  for (const model of models) {
    const details = toModelDetails(model);
    if (!details) continue;
    if (!predicate(details)) continue;
    entries.set(details.id, details);
  }

  return Array.from(entries.values()).sort((a, b) => a.id.localeCompare(b.id));
}
