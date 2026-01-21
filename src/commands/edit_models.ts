import { listImageEditModels, listImageEditModelDetails } from "../openrouter";
import { renderJson, renderPlain } from "../output";

export interface EditModelsOptions {
  json?: boolean;
  details?: boolean;
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

export async function editModelsCommand(opts: EditModelsOptions) {
  const argv = process.argv.slice(2);
  const json = Boolean(opts.json || argvHasFlag(argv, "--json"));
  const timeout = opts.timeout ?? argvGetOptionValue(argv, "--timeout");
  const details = Boolean(opts.details || argvHasFlag(argv, "--details"));

  const timeoutMs = timeout ? parseInt(timeout, 10) : undefined;
  if (details) {
    const models = await listImageEditModelDetails({ timeoutMs });
    if (json) {
      renderJson(models);
      return;
    }
    for (const model of models) renderPlain(formatModelDetails(model));
    return;
  }

  const ids = await listImageEditModels({ timeoutMs });

  if (json) {
    renderJson(ids);
    return;
  }

  for (const id of ids) renderPlain(id);
}

function formatModelDetails(model: {
  id: string;
  contextLength?: number;
  inputModalities: string[];
  outputModalities: string[];
  pricing?: { prompt?: string; completion?: string; request?: string; image?: string };
}) {
  const ctx = model.contextLength ? `ctx=${model.contextLength}` : "ctx=?";
  const input = `in=${model.inputModalities.join(",")}`;
  const output = `out=${model.outputModalities.join(",")}`;
  const pricing = model.pricing
    ? [
        `in$=${model.pricing.prompt ?? "-"}`,
        `out$=${model.pricing.completion ?? "-"}`,
        model.pricing.image ? `img$=${model.pricing.image}` : undefined,
        model.pricing.request ? `req$=${model.pricing.request}` : undefined,
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;

  return [model.id, ctx, input, output, pricing].filter(Boolean).join("\t");
}
