import { SUPPORTED_PRESETS, loadPresetPrompt } from "../presets";
import { renderPlain, renderJson } from "../output";

export async function presetsListCommand(opts: { json?: boolean; plain?: boolean; quiet?: boolean }) {
  if (opts.json) {
    renderJson({
      ok: true,
      command: "presets list",
      presets: SUPPORTED_PRESETS.map((name) => ({ name })),
    });
  } else if (!opts.quiet) {
    for (const name of SUPPORTED_PRESETS) {
      renderPlain(name);
    }
  }
}

export async function presetsShowCommand(name: string, opts: { json?: boolean; quiet?: boolean }) {
  const content = await loadPresetPrompt(name);
  if (opts.json) {
    renderJson({ ok: true, command: "presets show", name, content });
  } else if (!opts.quiet) {
    renderPlain(content);
  }
}
