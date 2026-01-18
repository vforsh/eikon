import { getEffectiveConfig } from "../config";
import { AuthError } from "../errors";
import { listImageGenModels } from "../openrouter";
import { renderJson, renderPlain } from "../output";

export interface GenerateModelsOptions {
  json?: boolean;
  apiKeyFile?: string;
  apiKeyStdin?: boolean;
  timeout?: string;
}

function argvHasFlag(argv: string[], flag: string) {
  return argv.includes(flag);
}

function argvGetOptionValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((v) => v.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

export async function generateModelsCommand(opts: GenerateModelsOptions) {
  const argv = process.argv.slice(2);
  const json = Boolean(opts.json || argvHasFlag(argv, "--json"));
  const apiKeyFile = opts.apiKeyFile ?? argvGetOptionValue(argv, "--api-key-file");
  const apiKeyStdin = Boolean(opts.apiKeyStdin || argvHasFlag(argv, "--api-key-stdin"));
  const timeout = opts.timeout ?? argvGetOptionValue(argv, "--timeout");

  let apiKey: string | undefined;
  if (apiKeyStdin) {
    apiKey = (await Bun.stdin.text()).trim();
  } else if (apiKeyFile) {
    const file = Bun.file(apiKeyFile);
    if (await file.exists()) {
      apiKey = (await file.text()).trim();
    } else {
      throw new AuthError(`API key file not found: ${apiKeyFile}`);
    }
  }

  const timeoutMs = timeout ? parseInt(timeout, 10) : undefined;

  // Try unauthenticated first; if /models requires auth, retry with effective API key.
  try {
    const ids = await listImageGenModels({ timeoutMs });
    if (json) {
      renderJson(ids);
    } else {
      for (const id of ids) renderPlain(id);
    }
    return;
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
  }

  const config = await getEffectiveConfig({ apiKey, timeoutMs });
  if (!config.apiKey) {
    throw new AuthError("Missing API key.", [
      "Set OPENROUTER_API_KEY, or run: eikon config init",
      "Or pass --api-key-file PATH / --api-key-stdin",
    ]);
  }

  const ids = await listImageGenModels({ apiKey: config.apiKey, timeoutMs: config.timeoutMs });
  if (json) {
    renderJson(ids);
  } else {
    for (const id of ids) renderPlain(id);
  }
}
