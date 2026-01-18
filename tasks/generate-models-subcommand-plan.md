# Plan: `eikon generate models` (OpenRouter image-gen models)

## Goal

Add `eikon generate models` subcommand. Fetch OpenRouter model catalog. Filter to models supporting image generation. Output list.

## CLI UX

- Command: `eikon generate models`
- Default output: plain list; 1 model ID per line (stdout)
- `--json`: JSON array of model IDs (stdout)
- Auth: attempt unauthenticated first; if `/models` rejects, retry with API key
- Auth inputs (only if needed):
  - `OPENROUTER_API_KEY` env
  - config file via `eikon config init`
  - `--api-key-file <path>`
  - `--api-key-stdin`
- Timeout: `--timeout <ms>` (fallback to config/env default)

## OpenRouter API

- Endpoint: `GET https://openrouter.ai/api/v1/models`
- Filter rule: `model.architecture.output_modalities` contains `"image"`
- Result: list of model IDs; dedupe; stable sort (lexicographic)

## Error behavior

- Network / non-2xx: exit 7 (`NetworkError`)
- If `/models` requires auth and no key available: exit 4 (`AuthError`) with hints:
  - set `OPENROUTER_API_KEY` or `eikon config init`
  - or pass `--api-key-file` / `--api-key-stdin`
- Timeout: treated as network error (exit 7)

## Implementation steps

1) Add OpenRouter model-list fetch helper
   - File: `src/openrouter.ts`
   - Function: `listImageGenModels({ apiKey?, timeoutMs? }) -> Promise<string[]>`
   - Mocking: if `EIKON_MOCK_OPENROUTER=1`, return small fixed list (no network)

2) Add new command handler
   - File: `src/commands/generate_models.ts`
   - Function: `generateModelsCommand(opts)`
   - Behavior:
     - try unauth `listImageGenModels`
     - on auth failure: resolve effective config + retry with api key
     - render plain or JSON array
   - Commander option-collision workaround:
     - when invoked as `eikon generate models --json` etc, `--json` may be consumed by parent `generate`
     - fallback: parse `process.argv` for `--json`, `--timeout`, `--api-key-file`, `--api-key-stdin`

3) Wire subcommand into CLI
   - File: `src/cli.ts`
   - Attach: `generate.command("models")`
   - Help examples:
     - `eikon generate models`
     - `eikon generate models --json`

4) Docs
   - File: `README.md`
   - Add mention under “Generating images”

5) Tests (no network)
   - File: `tests/e2e.test.ts`
   - Add:
     - `eikon generate models` prints lines incl default image-gen model ID
     - `eikon generate models --json` parses JSON array incl same ID
   - Use existing test harness env: `EIKON_MOCK_OPENROUTER=1`

## Verify / Gate

- `bun run test:e2e`
