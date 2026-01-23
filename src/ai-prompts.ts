import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AI_PROMPTS_DIR = join(__dirname, "..", "prompts", "ai");

export const AI_PROMPT_FILES = {
  "edit-system": join(AI_PROMPTS_DIR, "edit-system.md"),
  "remove-bg": join(AI_PROMPTS_DIR, "remove-bg.md"),
  "extend": join(AI_PROMPTS_DIR, "extend.md"),
  "variations": join(AI_PROMPTS_DIR, "variations.md"),
  "describe": join(AI_PROMPTS_DIR, "describe.md"),
};

export async function loadAiPrompt(name: keyof typeof AI_PROMPT_FILES): Promise<string> {
  const file = Bun.file(AI_PROMPT_FILES[name]);
  return await file.text();
}

export async function loadAiPromptWithVars(
  name: keyof typeof AI_PROMPT_FILES,
  vars: Record<string, string>
): Promise<string> {
  let prompt = await loadAiPrompt(name);
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return prompt.trim();
}
