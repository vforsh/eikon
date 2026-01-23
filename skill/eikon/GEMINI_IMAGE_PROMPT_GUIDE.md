# Gemini Image Models Prompt Guide

Best practices for prompting Google Gemini image generation models:

- `google/gemini-3-pro-image-preview` (Nano Banana Pro)
- `google/gemini-2.5-flash-image`

> Based on [Google's official prompt guide](https://ai.google.dev/gemini-api/docs/image-generation#prompt-guide)

## Core Principle

**Describe scenes narratively rather than listing keywords.** The model excels at language understanding, so detailed, descriptive paragraphs consistently outperform disconnected word lists.

```bash
# Bad - keyword list
eikon generate --prompt "cat, cute, kawaii, sticker, transparent background" --out cat.png

# Good - narrative description
eikon generate --prompt "A kawaii-style sticker of a fluffy orange cat with big sparkly eyes, sitting happily. Cel-shaded illustration with clean black outlines and soft pastel colors. Transparent background." --out cat.png
```

## Prompting Strategies

### Photorealistic Scenes

Use photography terminology to guide the model toward realistic results:

- Camera angles and lens types
- Lighting descriptions
- Fine textural details
- Mood and atmosphere

```bash
eikon generate \
  --prompt "A close-up portrait of an elderly craftsman in his woodworking shop, captured with an 85mm lens. Golden hour light streams through dusty windows, emphasizing the fine textures of his weathered hands and wood shavings. Shallow depth of field creates soft bokeh in the background." \
  --out craftsman.png
```

### Stylized Illustrations & Stickers

Be explicit about artistic style and design requirements:

- Specify the art style (kawaii, cel-shading, vector, flat design)
- Request transparent or specific backgrounds
- Define line and shading styles
- Mention color palettes

```bash
eikon generate \
  --prompt "A vector illustration of a coffee cup with steam rising, minimalist flat design style. Clean geometric shapes, limited color palette of warm browns and cream. No outlines, solid color fills only. White background." \
  --out coffee-icon.png
```

### Accurate Text in Images

For text-heavy designs, use `google/gemini-3-pro-image-preview` for best results:

- Clearly state the exact text to render
- Describe font styles descriptively (not font names)
- Specify overall design context
- Define color schemes

```bash
eikon generate \
  --prompt "A motivational poster with the text 'START TODAY' in bold, modern sans-serif lettering. Large dramatic typography centered on a gradient background transitioning from deep purple to vibrant orange. Clean, professional design suitable for social media." \
  --model google/gemini-3-pro-image-preview \
  --out poster.png
```

### Product Mockups

Create professional commercial photography:

- Studio lighting setups
- Camera angles that showcase key features
- Surface descriptions
- Shadow and highlight treatment

```bash
eikon generate \
  --prompt "Professional product photography of a minimalist white ceramic mug on a light gray concrete surface. Soft studio lighting from the left creates gentle shadows. Shot from a 45-degree angle to show both the rim and handle. Clean, modern commercial aesthetic." \
  --out mug-mockup.png
```

### Minimalist & Negative Space

For backgrounds and design templates:

- Specify subject positioning
- Emphasize "vast empty canvas"
- Create space for overlaid text
- Use subtle, soft lighting

```bash
eikon generate \
  --prompt "A serene landscape with a lone tree positioned in the lower left third of the frame. Vast empty sky taking up most of the image, soft gradient from pale blue to white. Minimalist composition with plenty of negative space on the right side for text overlay." \
  --out background.png
```

### Using Reference Images

Maintain style consistency or use existing images as inspiration:

```bash
# Single reference for style
eikon generate \
  --prompt "A new character in the exact same art style as the reference image. A young wizard with a pointed hat and flowing robes, cheerful expression." \
  --ref ./existing-character.png \
  --out wizard.png

# Multiple references for combining elements
eikon generate \
  --prompt "Combine the color palette from the first image with the composition style of the second image. A sunset beach scene." \
  --ref ./color-ref.png \
  --ref ./composition-ref.png \
  --out combined.png
```

## What Works Well

| Do | Don't |
|----|-------|
| Write full descriptive sentences | List disconnected keywords |
| Use specific technical terms (lens, lighting) | Use vague descriptions |
| Describe mood and atmosphere | Assume the model infers context |
| Specify art style explicitly | Hope it matches your mental image |
| Include positioning/composition details | Leave layout to chance |

## Model Selection

| Model | Best For |
|-------|----------|
| `google/gemini-3-pro-image-preview` | Complex scenes, accurate text, professional quality |
| `google/gemini-2.5-flash-image` | Speed, simple generations, quick iterations |

## Tips

1. **Iterate and refine** - Start with a basic prompt, then add details based on results
2. **Be specific about what you don't want** - "No text", "Clean background", "No watermarks"
3. **Specify aspect ratio needs** - Mention if you need landscape, portrait, or square
4. **Use the `--ref` flag** for style consistency across multiple generations
5. **Check `eikon generate models`** to see available image generation models
