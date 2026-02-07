# AGENTS.md

## What is Eikon

CLI tool for image analysis and processing via OpenRouter vision models + local Sharp operations. Runs on **Bun** (>=1.3.5) — no build step; TypeScript executed directly.

## Commands

```bash
bun install          # install deps
bun test             # all tests
bun test tests/e2e.test.ts        # E2E only
bun test tests/placeholder.test.ts # placeholder only
bun test tests/resize.test.ts     # resize only
./index.ts --help    # run CLI locally
```

No lint/format tooling configured. No build step — Bun runs `.ts` directly via shebang.

## Architecture

**Entry**: `index.ts` → `src/cli.ts:createProgram()` → Commander.js program with ~15 command groups.

**Core modules**:
- `src/cli.ts` — command registration, global options, error boundary
- `src/openrouter.ts` — OpenRouter API client (chat completions)
- `src/image.ts` — image loading, metadata extraction, resizing (Sharp)
- `src/config.ts` — TOML config parsing (`~/.config/eikon/config.toml`)
- `src/errors.ts` — typed error hierarchy with exit codes (0-8)
- `src/output.ts` — output rendering (human/plain/JSON) + file output policy
- `src/resize.ts` — resize dimension calculation
- `src/mask.ts` — shape masking (circle, rounded-rect, squircle) via SVG
- `src/presets.ts` — built-in prompt templates from `prompts/` dir
- `src/env.ts` — environment variable accessors

**Command pattern**: each command lives in `src/commands/<name>.ts`, exports a setup function that receives a Commander parent command, defines args/options/action. Commands throw `EikonError` subclasses; the error boundary in `cli.ts` catches and renders them.

**Command groups**: `analyze`, `upscale:local`, `save`, `atlas` (split/extract/create), `transform` (rotate/flip/crop/pad/trim/mask/shift), `fx` (shadow/outline/glow/blur/tint), `adjust` (brightness/contrast/saturation/vibrance), `placeholder`, `compose`, `presets`, `config`, `openrouter`.

**Config precedence**: CLI flags → env vars → config file → defaults.

**Output modes** (mutually exclusive): human (default), `--plain`, `--json`. File output via `--output` (+ `--quiet` to suppress stdout).

## Dependencies

- `commander` — CLI argument parsing
- `@openrouter/sdk` — OpenRouter API client
- `sharp` — local image processing
- `maxrects-packer` — sprite atlas bin packing

## Testing

Tests spawn the CLI as a subprocess via `Bun.spawn` and check stdout/stderr/exit codes. Mock OpenRouter with `EIKON_MOCK_OPENROUTER=1` env var. Fixtures in `fixtures/`.

## Environment Variables

- `OPENROUTER_API_KEY` — API key (required for remote commands)
- `OPENROUTER_MODEL` — default model override
- `EIKON_TIMEOUT_MS` — request timeout (default 30000)
- `EIKON_MOCK_OPENROUTER` — enable mock for tests
- `NO_COLOR` — disable color output
