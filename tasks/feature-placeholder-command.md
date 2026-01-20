# Feature plan: `placeholder` command

## Goal

Add a new top-level CLI command `eikon placeholder` that generates a placeholder image with:

- Explicit **dimensions** (`--width`, `--height`, with shorthands `--w`, `--h`)
- **Background color** (`--bg-color`)
- **Centered text** (`--text`, defaulting to `"<width>x<height>"`)
- Optional **text color** (`--text-color`)
- Optional **font controls** (`--font-family`, `--font-weight`, `--font-size`)
- Optional **font file** (`--font-file`)
- Multiline text via `\n`, with **auto-shrink** behavior so text fits (b + d)

Output should be written to `--out` (required), with format inferred from the output extension; output modes should mirror `upscale:local` (`--plain`, `--json`, `--quiet`).

## Current state

- **CLI wiring**: `src/cli.ts` uses `commander` and calls per-command functions in `src/commands/*`.
- **Local image processing**: `src/image.ts` dynamically loads `sharp` via `loadSharp()` and uses it in local commands.
- **Output conventions**: local commands (`src/commands/upscale_local.ts`, `src/commands/save.ts`) return early, validate args, write files with `--force`, and print either JSON or a stable plain summary.
- **Errors**: `src/errors.ts` provides `UsageError`, `FilesystemError`, `DependencyError`, etc., and the top-level runner formats them in `src/cli.ts`.

## Proposed design

### CLI surface area

New command: `eikon placeholder`

- **Required**
  - `--out <file>`: output path (extension determines format)
  - `--width <px>` / `--w <px>`
  - `--height <px>` / `--h <px>`
  - `--bg-color <color>`: background color
- **Optional**
  - `--text <string>`: supports `\n` for multiline; default: `${width}x${height}`
  - `--text-color <color>`: explicit text color; if omitted, **auto-pick** a high-contrast color based on `--bg-color` (choose black/white by whichever yields higher contrast)
  - `--font-family <name>`: best-effort (system fonts)
  - `--font-weight <weight>`: numeric `100..900` or keywords (`normal`, `bold`) (best-effort)
  - `--font-size <px>`: starting font size before auto-shrink
  - `--font-file <path>`: path to a `.ttf`/`.otf` font file to use (deterministic across machines); if provided, prefer it over `--font-family`/`--font-weight`
  - `--padding <px>`: inner padding margin used for fitting (default e.g. 24)
  - `--force`: overwrite existing `--out`
  - `--json`, `--plain`, `--quiet`, `--no-color` (kept for parity even if unused)

Examples to add to help:

- `eikon placeholder --w 1200 --h 630 --bg-color "#0B1220" --text "Hello" --out out.png`
- `eikon placeholder --width 512 --height 512 --bg-color "#eee" --out ./512.png`
- `eikon placeholder --w 800 --h 400 --bg-color "#111827" --text "Line 1\nLine 2" --text-color "#F9FAFB" --out out.webp`

### Rendering approach (local, via `sharp`)

Use `sharp` to create a solid-color raster and overlay a rendered SVG for text:

1. **Validate inputs** (guard clauses):
   - width/height: positive integers
   - bg-color/text-color: parseable color (at minimum support hex `#RGB/#RRGGBB/#RRGGBBAA`)
   - out extension: `.png`, `.jpg/.jpeg`, `.webp` (or error)
   - if output exists and not `--force`, throw `FilesystemError`
   - if `--font-file` is provided:
     - require it exists and is readable
     - require extension `.ttf` or `.otf` (strict, at least initially)
2. **Choose effective text color**:
   - If `--text-color` is provided, use it.
   - Else compute contrast of `#000000` and `#ffffff` against `--bg-color` and pick whichever is higher.
   - Contrast computation (WCAG-style):
     - Convert sRGB to linear, compute relative luminance \(L\).
     - Contrast ratio \( (L_1 + 0.05) / (L_2 + 0.05) \) with \(L_1 \ge L_2\).
3. **Choose effective font**:
   - If `--font-file` is provided:
     - Use it for rendering (deterministic).
     - Embed it into the SVG via a `<style>@font-face { font-family: ...; src: url(data:font/...;base64,...) }</style>` rule and set `font-family` on the `<text>`.
   - Else:
     - Use `--font-family`/`--font-weight` as best-effort (system fonts).
2. **Create base image**:
   - `sharp({ create: { width, height, channels: 4, background: rgba }})`
3. **Build an SVG overlay**:
   - `<svg width=... height=...>`
   - `<text>` centered with `x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"`
   - For multiline, either:
     - use `<tspan x="50%" dy="...">` per line, with an initial `dy` to vertically center the block
4. **Auto-shrink to fit**:
   - Define a max text box: `(width - 2*padding)` by `(height - 2*padding)`
   - Start font size:
     - if `--font-size` provided: use it
     - else choose a heuristic (e.g. `Math.floor(Math.min(width, height) / 6)`)
   - While estimated bounds exceed max, reduce font-size (e.g. multiply by 0.9) until:
     - it fits, or
     - we hit a minimum font size (e.g. 8px) → then allow overflow or throw `UsageError` (pick one; recommended: **allow min-size clamp** and still render)
   - Estimation method (deterministic, no extra deps):
     - approximate text width by `maxLineLength * fontSize * 0.6`
     - approximate block height by `lines * fontSize * lineHeight` (lineHeight default 1.2)
5. **Composite SVG onto base**:
   - `base.composite([{ input: Buffer.from(svg), top: 0, left: 0 }])`
6. **Encode based on `--out` extension**:
   - `.png`: `png({ compressionLevel: 9 })`
   - `.webp`: `webp({ lossless: true })` (or lossy if desired later)
   - `.jpg/.jpeg`: `jpeg({ quality: 92, mozjpeg: true })` (note: background alpha should be flattened)

### Output shape (match existing commands)

- **Plain/default** (when not `--quiet`):
  - `Path: ...`
  - `MIME: ...`
  - `Bytes: ...`
  - `Width: ...`
  - `Height: ...`
  - `Background: ...`
  - `Text: ...` (optional; may include `\n`)
  - `Text Color: ...`
  - `Font: ...` (family/weight/size used)
- **JSON**:
  - `{ ok: true, outPath, mime, bytes, width, height, bgcolor, text, textColor, font: { family?, weight?, size }, fitting: { padding, minFontSize, finalFontSize } }`

## Touch points

- `src/cli.ts`
  - Add import for `placeholderCommand`
  - Register new `.command("placeholder")` with options:
    - `.requiredOption("--out <file>")`
    - `.requiredOption("--width <px>")` plus `.option("--w <px>")` alias mapping
    - `.requiredOption("--height <px>")` plus `.option("--h <px>")` alias mapping
    - `.requiredOption("--bg-color <color>")`
    - `.option("--text <text>")`
    - `.option("--text-color <color>")`
    - `.option("--font-file <path>")`
    - font options
    - `--force`, `--json`, `--plain`, `--quiet`, `--no-color`
  - Implement alias resolution (e.g. if `--w` set and `--width` not set, use it; if both set and differ → `UsageError`)

- `src/commands/placeholder.ts` (new)
  - Parse/validate options (guard clauses)
  - Detect mime/encoder from `--out` extension
  - Render placeholder via `sharp` (base + SVG composite)
  - Write file, return output in json/plain per conventions

- `src/image.ts` (optional)
  - If useful, add small shared helpers:
    - parse color → `{ r,g,b,alpha }`
    - infer mime from output path extension
  - (Keep scope tight: only if it meaningfully reduces duplication.)

- `README.md` (optional)
  - Add `placeholder` command and a few examples under Usage.

- `tests/placeholder.test.ts` (new)
  - Generate a placeholder into a temp directory, then:
    - verify file exists
    - verify reported width/height via `sharp(...).metadata()`
    - verify format selection by output extension (png/webp/jpeg)
  - Add at least one multiline + auto-shrink case.

## Rollout order

1. Add `src/commands/placeholder.ts` with core rendering logic and output formatting.
2. Wire `placeholder` into `src/cli.ts` with help text + aliases.
3. Add tests for basic generation + format inference + multiline auto-shrink.
4. (Optional) Update `README.md` usage/examples.

## Risks / edge cases

- **Font availability**: `--font-family` / `--font-weight` are best-effort and may render differently across machines.
- **Font file portability**: `--font-file` makes output consistent, but increases complexity (validation, embedding base64 in SVG, file size).
- **SVG text measurement**: without extra deps, fitting uses heuristics; the auto-shrink loop must cap iterations and clamp to a minimum font size.
- **Alpha + JPEG**: JPEG doesn’t support alpha; must flatten background before encoding.
- **Color parsing**: decide what formats to accept; start with hex to keep validation strict.
- **Very small images**: padding and min font size can exceed available space; clamp padding and font size.

## Testing notes

- Smoke test:
  - `eikon placeholder --w 1200 --h 630 --bg-color "#111827" --text "Hello" --out /tmp/ph.png`
- Verify multiline:
  - `eikon placeholder --w 800 --h 400 --bg-color "#eee" --text "Line 1\nLine 2" --out /tmp/ph.webp`
- Verify overwrite behavior:
  - run twice; second should error unless `--force`

## Final checklist

- Run `bun test` (and add/adjust tests as needed).
- Run `bun run test:e2e` if it covers CLI execution paths.
- Run `npm run typecheck` and `npm run lint` and fix any errors (use `npm run lint:fix` when appropriate).

