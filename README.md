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
- OpenRouter provisioning key for admin endpoints:
  - `OPENROUTER_PROVISIONING_KEY` (env)
  - `eikon openrouter <subcommand> --api-key <key>`

## Install

Published package:

```bash
bunx @vforsh/eikon --help
npx @vforsh/eikon --help
```

Global install:

```bash
bun add -g @vforsh/eikon
npm install -g @vforsh/eikon
```

`eikon` is a Bun CLI. `bunx` works directly. `npx` also works, but Bun still must be installed and available on `PATH` because the package binary uses `#!/usr/bin/env bun`.

The npm package is scoped as `@vforsh/eikon`. The installed executable is still `eikon`.

## Install (local development)

```bash
bun install
bun link
```

## Usage

```bash
eikon <command> [options]

Commands:
  analyze       Analyze an image with a prompt/preset (default command)
  analyze:local Show local image information (no LLM)
  upscale:local Upscale an image locally via sharp
  save          Save an image from piped dataURL or --input file
  placeholder   Generate a placeholder image with background and text
  compose       Layer images in order with opacity and blend modes
  presets       List/show prompt presets
  config        Manage config (init/show/path)
  openrouter    OpenRouter provisioning endpoints
  atlas         Sprite atlas operations
  transform     Image transformation operations
  fx            Visual effects (shadow, inner-shadow, outline, glow, blur, tint)
  adjust        Image adjustments (brightness, contrast, saturation, vibrance)
  inpaint-mask  Generate an inpainting mask (white=inpaint, black=keep)
  describe      Describe a command as machine-readable JSON
  help          Show help for a command
```

### Examples

```bash
# Help
eikon --help
eikon help analyze
eikon help analyze --json
eikon describe atlas split

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

# Get local image info (no LLM)
eikon analyze:local ./image.png
eikon analyze:local ./image.png --plain
eikon analyze:local ./image.png --json

# Upscale locally via sharp
eikon upscale:local ./image.png --out ./image@2x.png
eikon upscale:local ./image.png --out ./image@2x.png --height 2400 --plain

# Create a placeholder image
eikon placeholder --w 1200 --h 630 --bg-color "#111827" --out placeholder.png

# Compose layers
eikon compose --layer base.png --layer overlay.png:0.5:multiply --out result.png

# Atlas operations
eikon atlas split spritesheet.png --out ./sprites/
eikon atlas split spritesheet.png --atlas-json sprites.json --out ./sprites/
eikon atlas create ./sprites/ --out atlas.png

# Transform images
eikon transform rotate ./image.png --angle 90 --out rotated.png
eikon transform pad ./image.png --all 32 --out padded.png

# Add local image effects
eikon fx shadow ./sprite.png --out ./sprite-shadow.png
eikon fx inner-shadow ./button.png --color "#5b3413" --blur 6 --dy 3 --opacity 0.6 --out ./button-inset.png
eikon fx glow ./icon.png --color "#ffd54a" --blur 12 --out ./icon-glow.png

# Adjust images
eikon adjust brightness ./photo.png --factor 1.2 --out ./bright.png
eikon adjust vibrance ./photo.png --amount 0.8 --out ./vibrant.png

# Generate inpainting masks
eikon inpaint-mask ./photo.png --region "left:48" --out ./mask.png

# Save an image from piped Argus/Playwright/etc dataURL output
# This extracts the base64 payload, decodes it, and writes the bytes to a file.
# Useful for saving screenshots from CI/E2E tools that output dataURLs.
argus eval ... | eikon save --out screenshot.png
eikon save --input dataurl.txt --out screenshot.png
eikon save --input dataurl.txt --out screenshot.png --force
eikon save --input dataurl.txt --out screenshot.png --json

# OpenRouter provisioning endpoints (requires provisioning key)
eikon openrouter keys --api-key "$OPENROUTER_PROVISIONING_KEY"
eikon openrouter guardrails --json
```

## Output behavior

- **stdout**: primary output (result)
- **stderr**: diagnostics/errors (never required to parse for success)

Output modes are mutually exclusive:
- Default (human): prints a human-readable response (for `analyze`, this is the model response text)
- `--plain`: stable, line-oriented output
- `--json`: stable JSON object

If `--output <file>` is provided, the result is written to the file and **also** printed to stdout (unless `--quiet` is set).

### JSON envelope (success)

```json
{
  "ok": true,
  "command": "analyze",
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

Every JSON success response includes:
- `ok: true`
- `command`: canonical command path, such as `analyze`, `atlas split`, or `config show`
- command-specific fields alongside `ok` and `command`

Every JSON error response uses:

```json
{
  "ok": false,
  "error": {
    "type": "usage",
    "code": 2,
    "message": "Human-readable error message",
    "hints": []
  }
}
```

### Runtime introspection

```bash
# Machine-readable help for the whole CLI
eikon help --json

# Machine-readable help for a specific command
eikon help analyze --json
eikon help atlas split --json

# Structured command description for agents
eikon describe analyze
eikon describe atlas split
```

`help --json` and `describe` return command metadata including:
- positional arguments
- options and whether they require values
- aliases
- subcommands
- the canonical JSON success/error envelope shape

## Downsizing images

- `--downsize`: downsizes to fit within **2048x2048** before upload.
- `--max-width` / `--max-height`: downsizes to fit within the given limits. Each accepts either:
  - pixels (e.g. `1600`)
  - multipliers (e.g. `x0.5`, `x0.25`)
- If the image is already within limits, **no resize/re-encode is performed**.

## Local image processing commands

- `eikon upscale:local`: resize images locally via Sharp
- `eikon placeholder`: generate placeholder images with text, gradients, and masks
- `eikon compose`: layer multiple images with opacity, blend modes, and offsets
- `eikon atlas split|extract|create`: split sprite sheets, extract frames, and build atlases
  - `atlas split --atlas-json <file>`: use TexturePacker JSON as input
  - `atlas extract --atlas-json <file>`: use TexturePacker JSON as input
  - `atlas create --no-metadata`: skip sidecar TexturePacker JSON generation
- `eikon transform rotate|flip|crop|pad|trim|mask|shift`: geometry and canvas operations
- `eikon fx shadow|inner-shadow|outline|glow|blur|tint`: visual effects
- `eikon adjust brightness|contrast|saturation|vibrance`: image adjustments
- `eikon inpaint-mask`: generate black/white masks for inpainting workflows

## Exit codes

- `0`: success
- `1`: external API error (OpenRouter admin endpoints)
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
- `OPENROUTER_PROVISIONING_KEY`: provisioning key for `openrouter` subcommands
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
analyzeModel = "google/gemini-3-flash-preview"
timeoutMs = 30000
```

Precedence: flags > env > config.

Notes:
- `analyzeModel` overrides `model` for `analyze`.
