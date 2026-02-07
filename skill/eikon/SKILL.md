---
name: eikon
description: Use the eikon CLI to analyze images with OpenRouter vision models, upscale and process images locally, and save dataURL screenshots. Use when working with images, vision AI, or visual analysis tasks.
compatibility: Requires Bun and an OpenRouter API key (env, file, stdin, or config).
---

## What this skill covers

- **Analyze images** with vision models (`eikon analyze`, `eikon ./image.png`)
- **Local image info** without LLM (`eikon analyze:local`)
- **Upscale images** locally (`eikon upscale:local`)
- **Save screenshots** from dataURL output (`eikon save`)
- **Create placeholder images** with text (`eikon placeholder`)
- **Adjust images** — brightness, contrast, saturation, vibrance (`eikon adjust`)
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

### Upscale images locally

```bash
eikon upscale:local ./image.png --out ./image@2x.png
eikon upscale:local ./image.png --out ./image@2x.png --scale 4
eikon upscale:local ./image.png --out ./image@2x.png --height 2400
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

### Transform images

```bash
# Rotate (degrees, any angle)
eikon transform rotate img.png --angle 90 --out rotated.png
eikon transform rotate img.png --angle 45 --bg-color "#ff0000" --out tilted.png

# Flip
eikon transform flip img.png --horizontal --out flipped.png
eikon transform flip img.png --vertical --out flipped.png

# Crop (px or %)
eikon transform crop img.png --left 10 --top 10 --width 200 --height 200 --out cropped.png
eikon transform crop img.png --left 10% --right 10% --out cropped.png

# Pad (px, per-side or --all)
eikon transform pad img.png --all 20 --out padded.png
eikon transform pad img.png --top 10 --bottom 10 --bg-color "#000" --out padded.png

# Trim transparent pixels (alpha-based)
eikon transform trim img.png --out trimmed.png
eikon transform trim img.png --threshold 10 --padding 5 --out trimmed.png
eikon transform trim img.png --top --bottom --out trimmed.png  # specific sides only

# Mask to shape (circle, rounded, squircle)
eikon transform mask img.png --shape circle --out masked.png
eikon transform mask img.png --shape "rounded:20" --out masked.png
eikon transform mask img.png --shape "squircle:15%" --out masked.png

# Shift content by x/y offset (positive = right/down, negative = left/up)
eikon transform shift img.png --x 50 --out shifted.png
eikon transform shift img.png --x -20 --y 30 --bg-color "#ff0000" --out shifted.png
eikon transform shift img.png --x 100 --y 50 --wrap --out shifted.png
```

### FX (visual effects)

```bash
# Drop shadow
eikon fx shadow img.png --out shadow.png
eikon fx shadow img.png --color "#000" --opacity 0.5 --blur 10 --dx 0 --dy 4 --spread 0 --out shadow.png

# Outline (stroke around opaque pixels)
eikon fx outline img.png --out outlined.png
eikon fx outline img.png --color "#ff0000" --width 3 --out outlined.png

# Glow
eikon fx glow img.png --out glow.png
eikon fx glow img.png --color "#fff" --opacity 0.8 --blur 10 --spread 0 --out glow.png

# Gaussian blur
eikon fx blur img.png --out blurred.png
eikon fx blur img.png --sigma 5 --out blurred.png

# Color tint
eikon fx tint img.png --color "#ff6600" --out tinted.png
eikon fx tint img.png --color "#3b82f6" --amount 0.5 --out tinted.png
```

### Adjust (image adjustments)

```bash
# Brightness (factor 0..10, default 1.0; <1 darken, >1 brighten, 0 = black)
eikon adjust brightness img.png --factor 1.5 --out bright.png
eikon adjust brightness img.png --factor 0.5 --out dark.png

# Contrast (factor 0..10, default 1.0; centered on middle gray)
eikon adjust contrast img.png --factor 1.5 --out contrast.png
eikon adjust contrast img.png --factor 0.5 --out low-contrast.png

# Saturation (factor 0..10, default 1.0; 0 = grayscale)
eikon adjust saturation img.png --factor 2 --out saturated.png
eikon adjust saturation img.png --factor 0 --out grayscale.png

# Vibrance (amount -1..1, default 0.5; smart saturation that protects already-saturated colors)
eikon adjust vibrance img.png --amount 0.8 --out vibrant.png
eikon adjust vibrance img.png --amount -0.5 --out muted.png
```

All transform/fx/adjust commands share: `--out` (required), `--force`, `--json`, `--plain`, `--quiet`.

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
timeoutMs = 30000
```

## Output modes

Mutually exclusive:

- **Default (human)**: human-readable response
- **`--plain`**: stable, line-oriented output
- **`--json`**: stable JSON object (shape depends on command)

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
