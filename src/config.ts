import { join } from "node:path";
import { homedir } from "node:os";
import { ENV } from "./env";
import { ConfigError } from "./errors";

export const DEFAULT_CONFIG_PATH = process.env.EIKON_CONFIG_PATH || join(homedir(), ".config", "eikon", "config.toml");

export interface Config {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export function stringifyConfigToml(config: Config): string {
  const lines: string[] = [];

  if (config.apiKey !== undefined) {
    lines.push(`apiKey = "${escapeTomlString(config.apiKey)}"`);
  }

  if (config.model !== undefined) {
    lines.push(`model = "${escapeTomlString(config.model)}"`);
  }

  if (config.timeoutMs !== undefined) {
    lines.push(`timeoutMs = ${config.timeoutMs}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `${lines.join("\n")}\n`;
}

export async function loadConfigFile(path: string = DEFAULT_CONFIG_PATH): Promise<Config> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }

  try {
    const text = await file.text();
    const parsed = Bun.TOML.parse(text) as any;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
    };
  } catch (error) {
    throw new ConfigError(`Failed to parse config file at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function getEffectiveConfig(flags: Config = {}): Promise<Config> {
  const fileConfig = await loadConfigFile();
  
  return {
    apiKey: flags.apiKey || ENV.OPENROUTER_API_KEY || fileConfig.apiKey,
    model: flags.model || ENV.OPENROUTER_MODEL || fileConfig.model,
    timeoutMs: flags.timeoutMs || ENV.EIKON_TIMEOUT_MS || fileConfig.timeoutMs || 30000,
  };
}
