import { OpenRouter } from "@openrouter/sdk";
import { UnauthorizedResponseError } from "@openrouter/sdk/models/errors";
import { AuthError, NetworkError } from "./errors";

export interface RequestOptions {
  apiKey: string;
  model: string;
  prompt: string;
  mimeType: string;
  imageBase64: string;
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
