import OpenAI from "openai";
import { AuthError, NetworkError } from "./errors";

export interface OpenRouterModelSummary {
  id: string;
  architecture?: {
    output_modalities?: string[];
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

export async function requestCompletion({
  apiKey,
  model,
  prompt,
  mimeType,
  imageBase64,
  timeoutMs,
}: RequestOptions): Promise<string> {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
  });

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
    });

    const text = response.choices?.[0]?.message?.content;
    if (!text) {
      throw new NetworkError("No response content received from the model.");
    }

    return text;
  } catch (error: any) {
    if (error.status === 401) {
      throw new AuthError("Invalid API key provided for OpenRouter.");
    }
    
    const message = error.message || String(error);
    throw new NetworkError(`OpenRouter API request failed: ${message}`);
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
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
  });

  try {
    const file = new File([imageBytes], "input", { type: mimeType });
    const response = await openai.images.edit({
      model,
      prompt,
      image: file,
    });

    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) {
      throw new NetworkError("No image data received from the model.");
    }
    return Buffer.from(b64, "base64");
  } catch (error: any) {
    if (error.status === 401) {
      throw new AuthError("Invalid API key provided for OpenRouter.");
    }

    const message = error.message || String(error);
    throw new NetworkError(`OpenRouter API request failed: ${message}`);
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
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
  });

  try {
    const response = await openai.chat.completions.create({
      model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
    } as any);

    const message: any = response.choices?.[0]?.message;
    const imageUrl: string | undefined = message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      throw new NetworkError("No image data received from the model.");
    }
    if (imageUrl.startsWith("data:")) {
      return decodeDataUrl(imageUrl);
    }
    throw new NetworkError("Model returned a non-data URL image.");
  } catch (error: any) {
    if (error.status === 401) {
      throw new AuthError("Invalid API key provided for OpenRouter.");
    }

    const message = error.message || String(error);
    throw new NetworkError(`OpenRouter API request failed: ${message}`);
  }
}

export async function requestImageFromPrompt({
  apiKey,
  model,
  prompt,
  ref,
  timeoutMs,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  ref?: { mimeType: string; imageBase64: string };
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
  });

  const content: any[] = [{ type: "text", text: prompt }];
  if (ref) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${ref.mimeType};base64,${ref.imageBase64}` },
    });
  }

  try {
    const response = await openai.chat.completions.create({
      model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content,
        },
      ],
    } as any);

    const message: any = response.choices?.[0]?.message;
    const imageUrl: string | undefined = message?.images?.[0]?.image_url?.url;
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
  } catch (error: any) {
    if (error.status === 401) {
      throw new AuthError("Invalid API key provided for OpenRouter.");
    }

    const message = error.message || String(error);
    throw new NetworkError(`OpenRouter API request failed: ${message}`);
  }
}

async function fetchOpenRouterModels({
  apiKey,
  timeoutMs,
}: {
  apiKey?: string;
  timeoutMs?: number;
}): Promise<OpenRouterModelSummary[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 30000);

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError("OpenRouter /models requires authentication.");
    }

    if (!response.ok) {
      throw new NetworkError(`OpenRouter /models failed: ${response.status} ${response.statusText}`);
    }

    const json: any = await response.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    return data as OpenRouterModelSummary[];
  } catch (error: any) {
    if (error instanceof AuthError || error instanceof NetworkError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new NetworkError("OpenRouter /models request timed out.");
    }
    throw new NetworkError(`OpenRouter /models request failed: ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

const EDIT_SYSTEM_PROMPT = `You are an image editing assistant. Your task is to modify the provided image according to the user's instruction while preserving as much of the original image as possible.

Guidelines:
- Only make the specific changes requested
- Preserve the original style, lighting, colors, and composition unless explicitly asked to change them
- Keep unchanged areas identical to the original
- Maintain the same resolution and aspect ratio
- If the instruction is unclear, make minimal changes`;

export async function requestImageEditWithPreservation({
  apiKey,
  model,
  instruction,
  mimeType,
  imageBase64,
  timeoutMs,
}: {
  apiKey: string;
  model: string;
  instruction: string;
  mimeType: string;
  imageBase64: string;
  timeoutMs?: number;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs,
  });

  try {
    const response = await openai.chat.completions.create({
      model,
      modalities: ["image", "text"],
      messages: [
        {
          role: "system",
          content: EDIT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
    } as any);

    const message: any = response.choices?.[0]?.message;
    const imageUrl: string | undefined = message?.images?.[0]?.image_url?.url;
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
  } catch (error: any) {
    if (error.status === 401) {
      throw new AuthError("Invalid API key provided for OpenRouter.");
    }

    const message = error.message || String(error);
    throw new NetworkError(`OpenRouter API request failed: ${message}`);
  }
}

export async function listImageGenModels({
  apiKey,
  timeoutMs,
}: {
  apiKey?: string;
  timeoutMs?: number;
}): Promise<string[]> {
  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    return [
      "google/gemini-3-pro-image-preview",
      "openai/gpt-5-image",
      "openai/gpt-5-image-mini",
    ].sort((a, b) => a.localeCompare(b));
  }

  const models = await fetchOpenRouterModels({ apiKey, timeoutMs });
  const ids: string[] = [];

  for (const model of models) {
    const output = model?.architecture?.output_modalities;
    if (!Array.isArray(output)) continue;
    if (!output.includes("image")) continue;
    if (typeof model?.id === "string" && model.id.trim()) {
      ids.push(model.id);
    }
  }

  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}
