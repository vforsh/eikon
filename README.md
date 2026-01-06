# Eikon

CLI for sending a prompt + image to an OpenRouter vision model.

Named after the Ancient Greek word “eikōn” (εἰκών), meaning “image,” “likeness,” or “icon.”

## Requirements

- Bun
- `OPENROUTER_API_KEY` env var (or pass `--api-key`)

## Install (local)

```bash
bun install
```

## Usage

```bash
eikon run <image> [prompt...] [--preset <name>] [--model <id>] [--downsize] [--max-width <px|x0.5>] [--max-height <px|x0.5>] [--out <file>] [--api-key <key>] [--json]
eikon init [--force]
```

### Examples

```bash
# Run anywhere with bunx (requires Bun installed)
bunx eikon run ./image.png "Describe the UI"

# Basic
bun run index.ts ./image.png "Describe the UI"

# Use the built-in web UI polish preset (no prompt required)
eikon run ./image.png --preset web-ui

# Use the built-in layout-only web UI preset (no prompt required)
eikon run ./image.png --preset web-ui-layout

# Use a different model
bun run index.ts ./image.png "Summarize" --model google/gemini-2.5-flash

# Write output to a file
bun run index.ts ./image.png "List objects" --out result.txt

# JSON output
bun run index.ts ./image.png "Extract labels" --json

# Downsize image before upload (defaults to max 2048x2048)
eikon run ./image.png --preset web-ui --downsize

# Downsize by max width/height in pixels (preserves aspect ratio, no upscaling)
eikon run ./image.png --preset web-ui --max-width 1600 --max-height 1200

# Downsize by multiplier (relative to original dimensions)
eikon run ./image.png --preset web-ui --max-width x0.5
```

## Output behavior

- Default: prints text to stdout.
- With `--out`: writes the raw text response to the file and does not print to stdout.
- With `--json` (and no `--out`): prints `{ "text": "..." }` to stdout.

## Downsizing images

- `--downsize`: downsizes to fit within **2048x2048** before upload.
- `--max-width` / `--max-height`: downsizes to fit within the given limits. Each accepts either:
  - pixels (e.g. `1600`)
  - multipliers (e.g. `x0.5`, `x0.25`)
- If the image is already within limits, **no resize/re-encode is performed**.

## Tests

```bash
bun test
bun run test:e2e
```

## Environment

- `OPENROUTER_API_KEY`: required unless `--api-key` is provided.
- `OPENROUTER_MODEL`: optional default model if `--model` is not set.

## Config file (TOML)

Run:

```bash
eikon init
```

This creates `~/.config/eikon/config.toml`.

Supported keys:

```toml
apiKey = "sk-or-v1-..."
model = "google/gemini-3-flash-preview"
```

Precedence: flags > env > config.
