import { SUPPORTED_PRESETS, loadPresetPrompt } from "../presets";
import { renderPlain, renderJson } from "../output";

export async function presetsListCommand(opts: { json?: boolean; plain?: boolean }) {
  if (opts.json) {
    renderJson(SUPPORTED_PRESETS.map(name => ({ name })));
  } else {
    for (const name of SUPPORTED_PRESETS) {
      renderPlain(name);
    }
  }
}

export async function presetsShowCommand(name: string, opts: { json?: boolean }) {
  const content = await loadPresetPrompt(name);
  if (opts.json) {
    renderJson({ ok: true, name, content });
  } else {
    renderPlain(content);
  }
}
