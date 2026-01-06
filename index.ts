#!/usr/bin/env bun

import { Command } from "commander";
import OpenAI from "openai";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { extname, resolve } from "node:path";

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const program = new Command();
program
  .name("eikon")
  .description("Send a prompt and image to an OpenRouter vision model")
  .version("0.1.0")
  .argument("<image>", "Path to image file (png/jpg/webp)")
  .argument("<prompt...>", "Prompt text")
  .option("--model <id>", "OpenRouter model ID", DEFAULT_MODEL)
  .option("--out <file>", "Write response to file instead of stdout")
  .option("--api-key <key>", "OpenRouter API key (overrides OPENROUTER_API_KEY)")
  .option("--json", "Output JSON to stdout")
  .allowExcessArguments(false);

program.parse();

const opts = program.opts<{
  model: string;
  out?: string;
  apiKey?: string;
  json?: boolean;
}>();

const [imageArg, promptParts] = program.args as [string, string[]];

if (!imageArg || !promptParts || promptParts.length === 0) {
  program.help({ error: true });
}

const prompt = promptParts.join(" ");
const imagePath = resolve(imageArg);

const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Missing API key. Set OPENROUTER_API_KEY or pass --api-key.");
  process.exit(1);
}

const mimeType = getImageMimeType(imagePath);

await assertReadableFile(imagePath);

const imageBase64 = await readFileAsBase64(imagePath);

const openai = new OpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
});

try {
  const response = await openai.chat.completions.create({
    model: opts.model || DEFAULT_MODEL,
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
    throw new Error("No response content received from the model.");
  }

  if (opts.out) {
    await writeFile(opts.out, text, "utf8");
    process.exit(0);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ text }) + "\n");
  } else {
    process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Request failed: ${message}`);
  process.exit(1);
}

async function assertReadableFile(filePath: string) {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    console.error(`Image not found or not readable: ${filePath}`);
    process.exit(1);
  }
}

async function readFileAsBase64(filePath: string) {
  const bytes = await readFile(filePath);
  return Buffer.from(bytes).toString("base64");
}

function getImageMimeType(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      console.error(`Unsupported image type: ${ext || "(no extension)"}`);
      process.exit(1);
  }
}
