import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG_PATH, getEffectiveConfig, stringifyConfigToml } from "../config";
import { renderHuman, renderJson, renderPlain } from "../output";
import { ConfigError } from "../errors";

export async function configInitCommand(opts: { force?: boolean; print?: boolean; json?: boolean }) {
  const file = Bun.file(DEFAULT_CONFIG_PATH);
  let overwritten = false;
  
  if (await file.exists()) {
    if (!opts.force) {
      throw new ConfigError(`Config already exists: ${DEFAULT_CONFIG_PATH}`, ["Use --force to overwrite."]);
    }
    overwritten = true;
  }

  const configDir = dirname(DEFAULT_CONFIG_PATH);
  await mkdir(configDir, { recursive: true });
  
  const template = `# Eikon config\n#\n# apiKey = "sk-or-v1-..."\n# model = "google/gemini-3-flash-preview"\n# timeoutMs = 30000\n`;
  await Bun.write(DEFAULT_CONFIG_PATH, template);

  if (opts.json) {
    renderJson({ ok: true, path: DEFAULT_CONFIG_PATH, created: true, overwritten });
  } else {
    if (opts.print) {
      renderPlain(DEFAULT_CONFIG_PATH);
    } else {
      renderHuman(`Wrote config to ${DEFAULT_CONFIG_PATH}`);
    }
  }
}

export async function configPathCommand() {
  renderPlain(DEFAULT_CONFIG_PATH);
}

export async function configShowCommand(opts: { json?: boolean }) {
  const config = await getEffectiveConfig();
  
  // Redact API key
  const safeConfig = {
    ...config,
    apiKey: config.apiKey ? "********" : undefined
  };

  if (opts.json) {
    renderJson({ ok: true, config: safeConfig });
  } else {
    renderPlain(stringifyConfigToml(safeConfig));
  }
}
