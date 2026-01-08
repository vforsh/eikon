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
