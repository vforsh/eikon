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
const DEFAULT_DOWNSIZE_MAX = 2048;

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
  .option(
    "--downsize",
    `Downsize image before upload (defaults to max ${DEFAULT_DOWNSIZE_MAX}x${DEFAULT_DOWNSIZE_MAX})`,
  )
  .option(
    "--max-width <px|x0.5>",
    'Downsize image to a maximum width in pixels (e.g. "1600") or as a multiplier (e.g. "x0.5")',
  )
  .option(
    "--max-height <px|x0.5>",
    'Downsize image to a maximum height in pixels (e.g. "1600") or as a multiplier (e.g. "x0.5")',
  )
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
  downsize?: boolean;
  maxWidth?: string;
  maxHeight?: string;
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

  await assertReadableFile(imagePath);

  const prompt = await resolvePrompt({
    preset: opts.preset,
    promptParts,
  });

  try {
    const mimeType = getImageMimeType(imagePath);
    const { imageBase64, mimeType: uploadMimeType } = await prepareImageForUpload({
      imagePath,
      mimeType,
      downsize: opts.downsize,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
    });

    let text: string;
    if (process.env.EIKON_MOCK_OPENROUTER === "1") {
      if (process.env.EIKON_TEST_IMAGE_INFO === "1") {
        const bytes = Buffer.from(imageBase64, "base64");
        text = `size:${bytes.length},mime:${uploadMimeType}`;
        try {
          const mod = await import("sharp");
          const sharp = mod.default;
          const meta = await sharp(bytes).metadata();
          text += `,w:${meta.width},h:${meta.height}`;
        } catch {
          text += ",no-sharp";
        }
      } else {
        text = MOCK_RESPONSE;
      }
    } else {
      text = await requestCompletion({
        apiKey,
        model: opts.model || process.env.OPENROUTER_MODEL || config.model || DEFAULT_MODEL,
        prompt,
        mimeType: uploadMimeType,
        imageBase64,
      });
    }

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

function parseResizeSpec(spec: string, original: number, flagName: string): number {
  const s = spec.trim();
  if (!s) {
    console.error(`Invalid ${flagName}: empty value`);
    process.exit(2);
  }

  if (s.startsWith("x")) {
    const factor = Number(s.slice(1));
    if (!Number.isFinite(factor) || factor <= 0) {
      console.error(`Invalid ${flagName}: "${spec}" (expected e.g. "x0.5")`);
      process.exit(2);
    }
    return Math.max(1, Math.round(original * factor));
  }

  const px = Number(s);
  if (!Number.isInteger(px) || px <= 0) {
    console.error(`Invalid ${flagName}: "${spec}" (expected pixels like "1600")`);
    process.exit(2);
  }
  return px;
}

async function prepareImageForUpload({
  imagePath,
  mimeType,
  downsize,
  maxWidth,
  maxHeight,
}: {
  imagePath: string;
  mimeType: string;
  downsize?: boolean;
  maxWidth?: string;
  maxHeight?: string;
}): Promise<{ imageBase64: string; mimeType: string }> {
  const shouldDownsize = Boolean(downsize || maxWidth || maxHeight);
  if (!shouldDownsize) {
    return { imageBase64: await readFileAsBase64(imagePath), mimeType };
  }

  let sharp: (typeof import("sharp"))["default"];
  try {
    const mod = await import("sharp");
    sharp = mod.default;
  } catch {
    console.error('Downsizing requires the "sharp" dependency. Run: bun install');
    process.exit(1);
  }

  const bytes = await Bun.file(imagePath).arrayBuffer();
  const inputBuffer = Buffer.from(bytes);

  const image = sharp(inputBuffer);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    console.error("Failed to read image dimensions for downsizing.");
    process.exit(1);
  }

  const widthLimit =
    maxWidth !== undefined
      ? parseResizeSpec(maxWidth, metadata.width, "--max-width")
      : downsize
        ? DEFAULT_DOWNSIZE_MAX
        : undefined;
  const heightLimit =
    maxHeight !== undefined
      ? parseResizeSpec(maxHeight, metadata.height, "--max-height")
      : downsize
        ? DEFAULT_DOWNSIZE_MAX
        : undefined;

  const needsResize =
    (widthLimit !== undefined && widthLimit < metadata.width) ||
    (heightLimit !== undefined && heightLimit < metadata.height);
  if (!needsResize) {
    return { imageBase64: inputBuffer.toString("base64"), mimeType };
  }

  let pipeline = sharp(inputBuffer)
    .rotate()
    .resize({
      width: widthLimit,
      height: heightLimit,
      fit: "inside",
      withoutEnlargement: true,
    });

  // Keep the original output format; avoid lossy re-encoding when possible.
  switch (mimeType) {
    case "image/png":
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case "image/webp":
      pipeline = pipeline.webp({ lossless: true });
      break;
    case "image/jpeg":
      pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
      break;
  }

  const outputBuffer = await pipeline.toBuffer();
  return { imageBase64: outputBuffer.toString("base64"), mimeType };
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
