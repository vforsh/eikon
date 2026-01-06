#!/usr/bin/env bun

import { Command } from "commander";
import OpenAI from "openai";
import { extname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_PRESET = "web-ui";
const CONFIG_PATH = join(homedir(), ".config", "eikon", "config.toml");
const MOCK_RESPONSE = "EIKON_E2E_MOCK_RESPONSE";

const program = new Command();
program
  .name("eikon")
  .description("Send a prompt and image to an OpenRouter vision model")
  .version("0.1.0");

const run = program
  .command("run", { isDefault: true })
  .description("Analyze an image with an optional prompt")
  .argument("<image>", "Path to image file (png/jpg/webp)")
  .argument("[prompt...]", "Prompt text (optional if --preset is set)")
  .option("--model <id>", "OpenRouter model ID", DEFAULT_MODEL)
  .option("--preset <name>", `Built-in prompt preset (currently: ${DEFAULT_PRESET})`)
  .option("--out <file>", "Write response to file instead of stdout")
  .option("--api-key <key>", "OpenRouter API key (overrides OPENROUTER_API_KEY)")
  .option("--json", "Output JSON to stdout")
  .allowExcessArguments(false)
  .action(async (imageArg: string, promptParts: string[] | undefined, options) => {
    await runEikon(imageArg, promptParts, options);
  });

program
  .command("init")
  .description("Create a default config file in your user config directory")
  .option("--force", "Overwrite existing config file")
  .action(async (options: { force?: boolean }) => {
    const configFile = Bun.file(CONFIG_PATH);
    if (await configFile.exists()) {
      if (!options.force) {
        console.error(`Config already exists: ${CONFIG_PATH}`);
        console.error("Use --force to overwrite.");
        process.exit(1);
      }
    }

    const configDir = join(homedir(), ".config", "eikon");
    await mkdir(configDir, { recursive: true });
    const template = `# Eikon config\n#\n# apiKey = \"sk-or-v1-...\"\n# model = \"${DEFAULT_MODEL}\"\n`;
    await Bun.write(CONFIG_PATH, template);
    process.stdout.write(`Wrote config to ${CONFIG_PATH}\n`);
  });

await program.parseAsync();

type RunOptions = {
  model?: string;
  preset?: string;
  out?: string;
  apiKey?: string;
  json?: boolean;
};

async function runEikon(
  imageArg: string,
  promptParts: string[] | undefined,
  opts: RunOptions,
) {
  const imagePath = resolve(imageArg);

  const config = await loadConfig();
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || config.apiKey;
  if (!apiKey) {
    console.error("Missing API key. Set OPENROUTER_API_KEY or pass --api-key.");
    process.exit(1);
  }

  const mimeType = getImageMimeType(imagePath);

  await assertReadableFile(imagePath);

  const imageBase64 = await readFileAsBase64(imagePath);
  const prompt = await resolvePrompt({
    preset: opts.preset,
    promptParts,
  });

  try {
    const text =
      process.env.EIKON_MOCK_OPENROUTER === "1"
        ? MOCK_RESPONSE
        : await requestCompletion({
            apiKey,
            model: opts.model || process.env.OPENROUTER_MODEL || config.model || DEFAULT_MODEL,
            prompt,
            mimeType,
            imageBase64,
          });

    if (opts.out) {
      await Bun.write(opts.out, text);
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
}

async function requestCompletion({
  apiKey,
  model,
  prompt,
  mimeType,
  imageBase64,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  mimeType: string;
  imageBase64: string;
}) {
  const openai = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });

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
    throw new Error("No response content received from the model.");
  }

  return text;
}

async function assertReadableFile(filePath: string) {
  const f = Bun.file(filePath);
  if (!(await f.exists())) {
    console.error(`Image not found or not readable: ${filePath}`);
    process.exit(1);
  }
}

async function readFileAsBase64(filePath: string) {
  const bytes = await Bun.file(filePath).arrayBuffer();
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

async function resolvePrompt({
  preset,
  promptParts,
}: {
  preset?: string;
  promptParts?: string[];
}) {
  const inlinePrompt = (promptParts || []).join(" ").trim();
  const presetPrompt = preset ? await loadPresetPrompt(preset) : "";

  if (!presetPrompt && !inlinePrompt) {
    console.error('Missing prompt. Provide "<prompt...>" or set --preset web-ui.');
    process.exit(2);
  }

  if (presetPrompt && inlinePrompt) {
    return `${presetPrompt}\n\nAdditional context from user:\n${inlinePrompt}`;
  }

  return presetPrompt || inlinePrompt;
}

async function loadPresetPrompt(name: string) {
  if (name !== DEFAULT_PRESET) {
    console.error(`Unknown preset: ${name}. Supported: ${DEFAULT_PRESET}`);
    process.exit(2);
  }

  const filePath = fileURLToPath(new URL("./prompts/web-ui.md", import.meta.url));
  return await Bun.file(filePath).text();
}

async function loadConfig(): Promise<{ apiKey?: string; model?: string }> {
  const configFile = Bun.file(CONFIG_PATH);
  if (!(await configFile.exists())) {
    return {};
  }

  try {
    const text = await configFile.text();
    const parsed = Bun.TOML.parse(text) as { apiKey?: string; model?: string };
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read config at ${CONFIG_PATH}: ${message}`);
    process.exit(1);
  }
}
