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
eikon run <image> [prompt...] [--preset <name>] [--model <id>] [--out <file>] [--api-key <key>] [--json]
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

# Use a different model
bun run index.ts ./image.png "Summarize" --model google/gemini-2.5-flash

# Write output to a file
bun run index.ts ./image.png "List objects" --out result.txt

# JSON output
bun run index.ts ./image.png "Extract labels" --json
```

## Output behavior

- Default: prints text to stdout.
- With `--out`: writes the raw text response to the file and does not print to stdout.
- With `--json` (and no `--out`): prints `{ "text": "..." }` to stdout.

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
