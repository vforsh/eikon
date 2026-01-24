---
name: eikon
description: Use the eikon CLI to analyze images with OpenRouter vision models, edit images with natural-language instructions, upscale images locally or via API, generate images from prompts, and save dataURL screenshots. Use when working with images, vision AI, or visual analysis tasks.
compatibility: Requires Bun and an OpenRouter API key (env, file, stdin, or config).
---

## What this skill covers

- **Analyze images** with vision models (`eikon analyze`, `eikon ./image.png`)
- **Local image info** without LLM (`eikon analyze:local`)
- **Upscale images** via OpenRouter or locally (`eikon upscale`, `eikon upscale:local`)
- **Generate images** from text prompts (`eikon generate`)
- **Edit images** with natural-language instructions (`eikon edit`)
- **Save screenshots** from dataURL output (`eikon save`)
- **Create placeholder images** with text (`eikon placeholder`)
- **Manage presets** and config (`eikon presets`, `eikon config`)

## Quick reference

### Analyze an image

```bash
# With prompt
eikon ./image.png "Describe the UI"

# With preset
eikon ./image.png --preset web-ui

# Layout-only preset (no prompt needed)
eikon ./image.png --preset web-ui-layout

# Different model
eikon ./image.png "Summarize" --model google/gemini-2.5-flash

# JSON output
eikon ./image.png "Extract labels" --json
```

### Downsize before upload

```bash
# Auto (max 2048x2048)
eikon ./image.png --preset web-ui --downsize

# Specific max dimensions
eikon ./image.png --preset web-ui --max-width 1600 --max-height 1200

# Relative multiplier
eikon ./image.png --preset web-ui --max-width x0.5
```

### Local image info (no LLM)

```bash
eikon analyze:local ./image.png
eikon analyze:local ./image.png --json
eikon analyze:local ./image.png --plain
```

### Upscale images

Via OpenRouter (default model: `google/gemini-2.5-flash-image`):

```bash
eikon upscale ./image.png --out ./image@2x.png
eikon upscale ./image.png --out ./image@4x.png --scale 4
eikon upscale ./image.png --out ./image@2x.png --width 2400 --json
```

Locally via sharp:

```bash
eikon upscale:local ./image.png --out ./image@2x.png
eikon upscale:local ./image.png --out ./image@2x.png --height 2400
```

### Generate images

See [Gemini Image Prompt Guide](./GEMINI_IMAGE_PROMPT_GUIDE.md) for detailed prompting best practices.

```bash
eikon generate --prompt "Minimal icon of a cat" --out ./cat.png
eikon generate --prompt "Same style, new pose" --ref /abs/path/ref.png --out ./out.png
eikon generate --prompt "Combine these images" --ref /path/img1.png --ref /path/img2.png --out ./combined.png
eikon generate --prompt "Use composition reference" --ref https://example.com/ref.png --out ./out.png
eikon generate models  # List models that support image generation
```

### Edit an image (AI)

Edits an existing image using a natural-language instruction and writes the edited image to `--out`.

```bash
eikon edit photo.png --prompt "Remove the background" --out photo-nobg.png
eikon edit ui.png --prompt "Change the primary button color to blue" --out ui-blue.png
eikon edit screenshot.png --prompt "Blur the email addresses" --out redacted.png
echo "Make it warmer" | eikon edit photo.png --prompt-stdin --out warm.png
```

### Save from dataURL

```bash
argus eval ... | eikon save --out screenshot.png
eikon save --input dataurl.txt --out screenshot.png
eikon save --input dataurl.txt --out screenshot.png --force --json
```

### Create placeholder images

```bash
# Basic placeholder (text defaults to WxH)
eikon placeholder --out placeholder.png --width 800 --height 600 --bg-color "#cccccc"

# Custom text
eikon placeholder --out banner.png -w 1200 -h 400 --bg-color "#3b82f6" --text "Hero Banner"

# No text (empty string)
eikon placeholder --out bg.png -w 512 -h 512 --bg-linear "#667eea,#764ba2,135" --text ""

# Multi-line text (use \n)
eikon placeholder --out card.png -w 400 -h 300 --bg-color "#1a1a1a" --text "Card Title\nSubtitle"

# Custom font settings
eikon placeholder --out custom.png -w 600 -h 400 --bg-color "#f0f0f0" \
  --text-color "#333333" --font-size 48 --font-weight bold

# Typography tweaks
eikon placeholder --out branded.png -w 800 -h 200 --bg-color "#000" \
  --font-family "Inter" --font-weight 600 --text "Branded Text"
```

**Shape masks** (`--mask`): Clip output to circle, rounded rect, or squircle.

```bash
# Circle (inscribed, radius = min(w,h)/2)
eikon placeholder -w 512 -h 512 --bg-color "#3b82f6" --mask circle --out avatar.png

# Rounded rectangle (auto 10% radius)
eikon placeholder -w 800 -h 400 --bg-color "#1a1a1a" --mask rounded --out card.png

# Rounded with explicit radius (px or %)
eikon placeholder -w 800 -h 400 --bg-color "#1a1a1a" --mask "rounded:32" --out card.png
eikon placeholder -w 512 -h 512 --bg-color "#1a1a1a" --mask "rounded:15%" --out icon.png

# Squircle (iOS-style superellipse, smoother than rounded)
eikon placeholder -w 512 -h 512 --bg-linear "#667eea,#764ba2,135" --mask squircle --out app.png
eikon placeholder -w 512 -h 512 --bg-linear "#667eea,#764ba2,135" --mask "squircle:22%" --out ios-icon.png
```

### Write output to file

```bash
eikon ./image.png "List objects" --output result.txt
eikon ./image.png "List objects" --output result.txt --quiet  # Suppress stdout
```

## API key setup

Priority: flags > env > config

```bash
# Environment variable
export OPENROUTER_API_KEY="sk-or-v1-..."

# Via file
eikon ./image.png --preset web-ui --api-key-file ./openrouter.key

# Via stdin
cat ./openrouter.key | eikon ./image.png --preset web-ui --api-key-stdin

# Config file
eikon config init  # Creates ~/.config/eikon/config.toml
```

### Config file (~/.config/eikon/config.toml)

```toml
apiKey = "sk-or-v1-..."
model = "google/gemini-3-flash-preview"
analyzeModel = "google/gemini-3-flash-preview"
generateModel = "google/gemini-3-pro-image-preview"
editModel = "google/gemini-3-pro-image-preview"
upscaleModel = "google/gemini-2.5-flash-image"
timeoutMs = 30000
```

## Output modes

Mutually exclusive:

- **Default (human)**: human-readable response
- **`--plain`**: stable, line-oriented output
- **`--json`**: stable JSON object (shape depends on command; e.g. `edit` includes `outPath`, `mime`, `bytes`, `model`, `source`, `timingMs`)

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Usage/validation error |
| 3 | Configuration error |
| 4 | Authentication error |
| 5 | Filesystem error |
| 6 | Dependency error |
| 7 | Network/API error |
| 8 | Internal error |

## Environment variables

- `OPENROUTER_API_KEY`: API key
- `OPENROUTER_MODEL`: default model
- `EIKON_TIMEOUT_MS`: default timeout (ms)
- `NO_COLOR`: disable color output

## Presets

List available presets:

```bash
eikon presets
eikon presets --json
eikon presets show web-ui
```

Built-in presets: `web-ui`, `web-ui-layout`
