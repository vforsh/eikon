import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "./errors";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

export const PRESET_FILES: Record<string, string> = {
  "web-ui": join(PROMPTS_DIR, "web-ui.md"),
  "web-ui-layout": join(PROMPTS_DIR, "web-ui-layout.md"),
};

export const SUPPORTED_PRESETS = Object.keys(PRESET_FILES).sort();

export async function loadPresetPrompt(name: string): Promise<string> {
  const filePath = PRESET_FILES[name];
  if (!filePath) {
    throw new UsageError(`Unknown preset: ${name}`, [
      `Supported presets: ${SUPPORTED_PRESETS.join(", ")}`
    ]);
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    throw new UsageError(`Preset file not found: ${filePath}`);
  }

  return await file.text();
}
