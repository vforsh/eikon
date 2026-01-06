# Eikon

CLI for sending a prompt + image to an OpenRouter vision model.

## Requirements

- Bun
- `OPENROUTER_API_KEY` env var (or pass `--api-key`)

## Install (local)

```bash
bun install
```

## Usage

```bash
eikon <image> <prompt...> [--model <id>] [--out <file>] [--api-key <key>] [--json]
```

### Examples

```bash
# Basic
bun run index.ts ./image.png "Describe the UI"

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

## Environment

- `OPENROUTER_API_KEY`: required unless `--api-key` is provided.
