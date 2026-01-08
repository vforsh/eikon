# Eikon

CLI for sending a prompt + image to an OpenRouter vision model.

Named after the Ancient Greek word “eikōn” (εἰκών), meaning “image,” “likeness,” or “icon.”

## Requirements

- Bun
- OpenRouter API key via one of:
  - `OPENROUTER_API_KEY` (env)
  - `--api-key-file <path>`
  - `--api-key-stdin`
  - config file (`eikon config init`)

## Install (local)

```bash
bun install
```

## Usage

```bash
eikon <command> [options]

Commands:
  analyze   Analyze an image with a prompt/preset (default command)
  presets   List/show prompt presets
  config    Manage config (init/show/path)
  help      Show help for a command
```

### Examples

```bash
# Help
eikon --help
eikon help analyze

# Analyze (explicit)
eikon analyze ./image.png "Describe the UI"

# Analyze (default command; same as `eikon analyze`)
eikon ./image.png --preset web-ui

# Use the built-in layout-only web UI preset (no prompt required)
eikon ./image.png --preset web-ui-layout

# Use a different model
eikon ./image.png "Summarize" --model google/gemini-2.5-flash

# Write output to a file (still prints to stdout; add --quiet to suppress stdout)
eikon ./image.png "List objects" --output result.txt
eikon ./image.png "List objects" --output result.txt --quiet

# JSON output
eikon ./image.png "Extract labels" --json

# Downsize image before upload (defaults to max 2048x2048)
eikon ./image.png --preset web-ui --downsize

# Downsize by max width/height in pixels (preserves aspect ratio, no upscaling)
eikon ./image.png --preset web-ui --max-width 1600 --max-height 1200

# Downsize by multiplier (relative to original dimensions)
eikon ./image.png --preset web-ui --max-width x0.5

# API key via file/stdin
eikon ./image.png --preset web-ui --api-key-file ./openrouter.key
cat ./openrouter.key | eikon ./image.png --preset web-ui --api-key-stdin

# Prompt via stdin
cat prompt.txt | eikon ./image.png --preset web-ui --prompt-stdin
```

## Output behavior

- **stdout**: primary output (result)
- **stderr**: diagnostics/errors (never required to parse for success)

Output modes are mutually exclusive:
- Default (human): prints the model response text
- `--plain`: stable, line-oriented output (same text payload, no decorations)
- `--json`: stable JSON object with `ok`, `text`, and `meta`

If `--output <file>` is provided, the result is written to the file and **also** printed to stdout (unless `--quiet` is set).

### JSON schema (success)

```json
{
  "ok": true,
  "text": "…model response…",
  "meta": {
    "model": "google/gemini-3-flash-preview",
    "preset": "web-ui",
    "image": {
      "path": "/abs/path.png",
      "mime": "image/png",
      "original": { "width": 3168, "height": 2774 },
      "processed": { "width": 2048, "height": 1793, "resized": true }
    },
    "timingMs": { "total": 1234, "uploadPrep": 120, "request": 1010 }
  }
}
```

## Downsizing images

- `--downsize`: downsizes to fit within **2048x2048** before upload.
- `--max-width` / `--max-height`: downsizes to fit within the given limits. Each accepts either:
  - pixels (e.g. `1600`)
  - multipliers (e.g. `x0.5`, `x0.25`)
- If the image is already within limits, **no resize/re-encode is performed**.

## Exit codes

- `0`: success
- `2`: usage / validation error
- `3`: configuration error
- `4`: authentication error (missing/invalid API key)
- `5`: filesystem error (missing/unreadable image)
- `6`: dependency error (optional dependency missing)
- `7`: network/API error
- `8`: unexpected internal error

## Tests

```bash
bun test
bun run test:e2e
```

## Environment

- `OPENROUTER_API_KEY`: API key (can be overridden by `--api-key-file` / `--api-key-stdin`)
- `OPENROUTER_MODEL`: default model if `--model` is not set
- `EIKON_TIMEOUT_MS`: default timeout (ms)
- `NO_COLOR`: disable color output

## Config file (TOML)

Run:

```bash
eikon config init
```

This creates `~/.config/eikon/config.toml`.

Supported keys:

```toml
apiKey = "sk-or-v1-..."
model = "google/gemini-3-flash-preview"
timeoutMs = 30000
```

Precedence: flags > env > config.
