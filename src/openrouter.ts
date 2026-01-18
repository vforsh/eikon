import OpenAI from "openai";
import { AuthError, NetworkError } from "./errors";

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
  return Buffer.from(match[2], "base64");
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
