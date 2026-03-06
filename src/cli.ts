import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze";
import { saveCommand } from "./commands/save";
import { presetsListCommand, presetsShowCommand } from "./commands/presets";
import { configInitCommand, configPathCommand, configShowCommand } from "./commands/config";
import { analyzeLocalCommand } from "./commands/analyze_local";
import { upscaleLocalCommand } from "./commands/upscale_local";
import { placeholderCommand } from "./commands/placeholder";
import { composeCommand } from "./commands/compose";
import { openrouterGuardrailsCommand, openrouterKeysCommand } from "./commands/openrouter";
import { atlasSplitCommand } from "./commands/atlas_split";
import { atlasExtractCommand } from "./commands/atlas_extract";
import { atlasCreateCommand } from "./commands/atlas_create";
import { transformRotateCommand } from "./commands/transform_rotate";
import { transformFlipCommand } from "./commands/transform_flip";
import { transformCropCommand } from "./commands/transform_crop";
import { transformPadCommand } from "./commands/transform_pad";
import { transformTrimCommand } from "./commands/transform_trim";
import { transformMaskCommand } from "./commands/transform_mask";
import { transformShiftCommand } from "./commands/transform_shift";
import { fxShadowCommand } from "./commands/fx_shadow";
import { fxInnerShadowCommand } from "./commands/fx_inner_shadow";
import { fxOutlineCommand } from "./commands/fx_outline";
import { fxGlowCommand } from "./commands/fx_glow";
import { fxBlurCommand } from "./commands/fx_blur";
import { fxTintCommand } from "./commands/fx_tint";
import { adjustBrightnessCommand } from "./commands/adjust_brightness";
import { adjustContrastCommand } from "./commands/adjust_contrast";
import { adjustSaturationCommand } from "./commands/adjust_saturation";
import { adjustVibranceCommand } from "./commands/adjust_vibrance";
import { inpaintMaskCommand } from "./commands/inpaint_mask";
import { EikonError, ExitCode } from "./errors";
import { renderError, renderJson } from "./output";

export async function createProgram() {
  const program = new Command();

  program
    .name("eikon")
    .description("Analyze images with vision models")
    .version("0.1.0")
    .addHelpText("before", `
 Examples:
   eikon analyze screenshot.png "What is this?"
   eikon screenshot.png --preset web-ui
   eikon screenshot.png --json --max-width 1024
   eikon analyze:local screenshot.png
   eikon upscale:local screenshot.png --out screenshot@2x.png --scale 2
   eikon placeholder --w 1200 --h 630 --bg-color "#111827" --out placeholder.png
   eikon compose --layer base.png --layer overlay.png:0.5:multiply --out result.png
   eikon presets list --plain
   eikon config init
  eikon openrouter keys --api-key "$OPENROUTER_PROVISIONING_KEY"
  eikon openrouter guardrails --json
 `);

  program
    .command("analyze", { isDefault: true })
    .description("Analyze an image with a prompt/preset (default command)")
    .argument("<image>", "Path to image file (png/jpg/webp)")
    .argument("[prompt...]", "Prompt fragments (joined with spaces)")
    .option("--plain", "Stable plain-text output")
    .option("--json", "JSON output")
    .option("-o, --output <file>", "Write result to file")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--verbose", "More diagnostics")
    .option("--debug", "Maximum diagnostics (includes stack traces)")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--preset <name>", "Use named preset prompt")
    .option("--prompt-stdin", "Read prompt from stdin")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--downsize", "Downsize image before upload")
    .option("--max-width <px|x0.5>", "Downsize max width")
    .option("--max-height <px|x0.5>", "Downsize max height")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
 Examples:
   eikon analyze screenshot.png "Describe this UI"
   eikon analyze screenshot.png --preset web-ui
   eikon analyze screenshot.png --prompt-stdin < prompt.txt
   eikon analyze screenshot.png --api-key-file .key --json
   eikon analyze screenshot.png --max-width 1600 --downsize
`)
    .action(async (image, prompt, options) => {
      await analyzeCommand(image, prompt, options);
    });

  program
    .command("analyze:local")
    .description("Show local image information (no LLM)")
    .argument("<image>", "Path to image file (png/jpg/webp)")
    .option("--plain", "Stable plain-text output")
    .option("--json", "JSON output")
    .addHelpText("before", `
  Examples:
    eikon analyze:local screenshot.png
    eikon analyze:local screenshot.png --plain
    eikon analyze:local screenshot.png --json
`)
    .action(async (image, options) => {
      await analyzeLocalCommand(image, options);
    });

  program
    .command("save")
    .description("Save an image from piped dataURL or --input file")
    .option("--input <file>", "Read input text from a file")
    .requiredOption("--out <file>", "Output path for the image bytes")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .addHelpText("before", `
  Examples:
    argus eval ... | eikon save --out screenshot.png
    eikon save --input dataurl.txt --out screenshot.png
    eikon save --input dataurl.txt --out screenshot.png --force
`)
    .action(async (options) => {
      await saveCommand(options);
    });

  program
    .command("upscale:local")
    .description("Upscale an image locally via sharp")
    .argument("<image>", "Path to image file (png/jpg/webp)")
    .requiredOption("--out <file>", "Output path for the image bytes")
    .option("--scale <2|4>", "Scale factor (default 2)")
    .option("--width <px>", "Target width (proportional)")
    .option("--height <px>", "Target height (proportional)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
  Examples:
    eikon upscale:local screenshot.png --out screenshot@2x.png
    eikon upscale:local screenshot.png --out screenshot@2x.png --scale 4
    eikon upscale:local screenshot.png --out screenshot@2x.png --height 2400
`)
    .action(async (image, options) => {
      await upscaleLocalCommand(image, options);
    });

  program
    .command("placeholder")
    .description("Generate a placeholder image with background and text")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--width <px>", "Image width in pixels")
    .option("--w <px>", "Image width in pixels (alias)")
    .option("--height <px>", "Image height in pixels")
    .option("--h <px>", "Image height in pixels (alias)")
    .option("--bg-color <color>", "Solid background color (hex)")
    .option("--bg-linear <spec>", 'Linear gradient "<hex1>,<hex2>,<angleDeg>"')
    .option("--bg-radial <spec>", 'Radial gradient "<innerHex>,<outerHex>[,<cx>,<cy>,<r>]"')
    .option("--text <string>", "Text to display (default: WxH, supports \\n for multiline)")
    .option("--text-color <color>", "Text color (hex, default: auto contrast)")
    .option("--text-outline", "Enable text outline")
    .option("--text-outline-color <color>", "Text outline color (hex)")
    .option("--text-outline-width <px>", "Text outline width in pixels")
    .option("--text-shadow", "Enable text shadow")
    .option("--text-shadow-color <color>", "Text shadow color (hex)")
    .option("--text-shadow-dx <px>", "Text shadow X offset (default: 0)")
    .option("--text-shadow-dy <px>", "Text shadow Y offset (default: 2)")
    .option("--text-shadow-blur <px>", "Text shadow blur (default: font-based)")
    .option("--text-shadow-opacity <0..1>", "Text shadow opacity (default: 0.35)")
    .option("--font-family <name>", "Font family (default: sans-serif)")
    .option("--font-weight <weight>", "Font weight: normal, bold, or 100-900")
    .option("--font-size <px>", "Starting font size before auto-shrink")
    .option("--padding <px>", "Inner padding for text fitting (default: 24)")
    .option("--mask <shape>", 'Shape mask: "circle", "rounded[:<radius>]", "squircle[:<radius>]"')
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
  Examples:
    eikon placeholder --w 1200 --h 630 --bg-color "#0B1220" --text "Hello" --out out.png
    eikon placeholder --width 512 --height 512 --bg-linear "#111827,#0ea5e9,135" --out ./512.png
    eikon placeholder --w 1200 --h 630 --bg-radial "#111827,#000,50%,40%,85%" --out out.webp
    eikon placeholder --w 800 --h 400 --bg-color "#111827" --text "Line 1\\nLine 2" --out out.png
`)
    .action(async (options) => {
      await placeholderCommand(options);
    });

  program
    .command("compose")
    .description("Layer images in order (first = bottom, last = top) with opacity and blend modes")
    .option("--layer <spec>", "Layer: <path>[@<x>,<y>][:<opacity>][:<blend>] (repeatable)", (value: string, prev: string[]) => prev.concat(value), [] as string[])
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--width <px>", "Canvas width (default: first layer's width)")
    .option("--height <px>", "Canvas height (default: first layer's height)")
    .option("--bg-color <hex>", "Background color for transparent areas")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
  Layers are composited in order: first layer is bottom, last is top.
  Canvas size defaults to first layer's dimensions, override with --width/--height.
  Offsets are relative to center (positive x = right, positive y = down).

  Examples:
    eikon compose --layer base.png --layer overlay.png --out result.png
    eikon compose --layer bg.png --layer fg.png:0.7 --out result.png
    eikon compose --layer a.png --layer b.png::multiply --out out.png
    eikon compose --layer a.png --layer b.png:0.5:screen --layer c.png:0.7 --out out.png
    eikon compose --layer base.png --layer icon.png@50,30 --out result.png
    eikon compose --layer base.png --layer icon.png@-20,-20:0.8 --out result.png
    eikon compose --width 200 --height 200 --layer bg.png --layer fg.png@0,50 --out result.png
`)
    .action(async (options) => {
      await composeCommand(options);
    });

  const presets = program.command("presets").description("List/show prompt presets");
  
  presets
    .command("list")
    .description("List available presets")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .addHelpText("before", `
Examples:
  eikon presets list
  eikon presets list --plain
  eikon presets list --json
`)
    .action(async (options) => {
      await presetsListCommand(options);
    });

  presets
    .command("show <name>")
    .description("Show a preset's prompt")
    .option("--json", "Output JSON")
    .addHelpText("before", `
Examples:
  eikon presets show web-ui
  eikon presets show web-ui --json
`)
    .action(async (name, options) => {
      await presetsShowCommand(name, options);
    });

  const config = program.command("config").description("Manage configuration");

  config
    .command("init")
    .description("Create a default config file")
    .option("--force", "Overwrite existing config")
    .option("--print", "Print the resulting path")
    .option("--json", "Output JSON")
    .addHelpText("before", `
Examples:
  eikon config init
  eikon config init --force
  eikon config init --json
`)
    .action(async (options) => {
      await configInitCommand(options);
    });

  config
    .command("path")
    .description("Print effective config path")
    .addHelpText("before", `
Examples:
  eikon config path
`)
    .action(async () => {
      await configPathCommand();
    });

  config
    .command("show")
    .description("Print effective config (redacted)")
    .option("--json", "Output JSON")
    .addHelpText("before", `
Examples:
  eikon config show
  eikon config show --json
`)
    .action(async (options) => {
      await configShowCommand(options);
    });

  const openrouter = program
    .command("openrouter")
    .description("OpenRouter provisioning endpoints");

  openrouter
    .command("keys")
    .description("List OpenRouter API keys (provisioning key required)")
    .option("--api-key <key>", "OpenRouter provisioning API key")
    .option("--json", "Output JSON")
    .addHelpText("before", `
Examples:
  eikon openrouter keys --api-key "$OPENROUTER_PROVISIONING_KEY"
  eikon openrouter keys --json
`)
    .action(async (options) => {
      await openrouterKeysCommand(options);
    });

  openrouter
    .command("guardrails")
    .description("List OpenRouter guardrails (provisioning key required)")
    .option("--api-key <key>", "OpenRouter provisioning API key")
    .option("--json", "Output JSON")
    .addHelpText("before", `
Examples:
  eikon openrouter guardrails --api-key "$OPENROUTER_PROVISIONING_KEY"
  eikon openrouter guardrails --json
`)
    .action(async (options) => {
      await openrouterGuardrailsCommand(options);
    });

  const atlas = program.command("atlas").description("Sprite atlas operations");

  atlas
    .command("split <image>")
    .description("Split a sprite atlas into individual sprite images")
    .requiredOption("--out <dir>", "Output directory for extracted sprites")
    .option("--json <file>", "TexturePacker JSON file for sprite regions")
    .option("--auto", "Auto-detect sprites by transparency (default if no --json)")
    .option("--metadata", "Generate sprites.json metadata file")
    .option("--force", "Overwrite existing files")
    .option("--json-output", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon atlas split spritesheet.png --out ./sprites/
  eikon atlas split spritesheet.png --json sprites.json --out ./sprites/
  eikon atlas split spritesheet.png --out ./sprites/ --metadata
  eikon atlas split spritesheet.png --auto --out ./sprites/ --force
`)
    .action(async (image, options) => {
      await atlasSplitCommand(image, options);
    });

  atlas
    .command("extract <image> <frames...>")
    .description("Extract specific frames from a sprite atlas (requires JSON data)")
    .requiredOption("--json <file>", "TexturePacker JSON file for sprite regions")
    .requiredOption("--out <dir>", "Output directory for extracted frames")
    .option("--force", "Overwrite existing files")
    .option("--json-output", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon atlas extract spritesheet.png player_idle --json sprites.json --out ./frames/
  eikon atlas extract spritesheet.png player_idle player_run --json sprites.json --out ./frames/
  eikon atlas extract spritesheet.png "player_*" --json sprites.json --out ./frames/
  eikon atlas extract spritesheet.png "enemy_?_idle" "player_*" --json sprites.json --out ./frames/
`)
    .action(async (image, frames, options) => {
      await atlasExtractCommand(image, frames, options);
    });

  atlas
    .command("create <inputs...>")
    .alias("bundle")
    .description("Create a sprite atlas from images or a folder")
    .requiredOption("--out <file>", "Output atlas path (.png, .jpg, .webp)")
    .option("--padding <px>", "Padding between sprites (default: 1)")
    .option("--format <type>", 'JSON format: "hash" (default) or "array"')
    .option("--no-json", "Skip JSON metadata generation")
    .option("--force", "Overwrite existing files")
    .option("--json-output", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon atlas create ./sprites/ --out atlas.png
  eikon atlas create sprite1.png sprite2.png sprite3.png --out atlas.png
  eikon atlas create ./sprites/ --out atlas.png --padding 2
  eikon atlas create ./sprites/ --out atlas.png --format array
  eikon atlas create ./sprites/ --out atlas.png --no-json
  eikon atlas bundle ./sprites/ --out atlas.png
`)
    .action(async (inputs, options) => {
      await atlasCreateCommand(inputs, options);
    });

  const transform = program.command("transform").description("Image transformation operations");

  transform
    .command("rotate <image>")
    .description("Rotate an image by an arbitrary angle")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--angle <degrees>", "Rotation angle in degrees (default: 0)")
    .option("--bg-color <hex>", "Background color for empty areas (default: transparent)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform rotate image.png --angle 45 --out rotated.png
  eikon transform rotate image.png --angle 90 --out rotated.png
  eikon transform rotate image.png --angle -30 --bg-color "#ffffff" --out rotated.jpg
`)
    .action(async (image, options) => {
      await transformRotateCommand(image, options);
    });

  transform
    .command("flip <image>")
    .description("Flip an image horizontally and/or vertically")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--horizontal", "Flip horizontally (mirror)")
    .option("--vertical", "Flip vertically")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform flip image.png --horizontal --out flipped.png
  eikon transform flip image.png --vertical --out flipped.png
  eikon transform flip image.png --horizontal --vertical --out flipped.png
`)
    .action(async (image, options) => {
      await transformFlipCommand(image, options);
    });

  transform
    .command("crop <image>")
    .description("Crop an image by coordinates or percentage")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--left <value>", "Left offset (px or %)")
    .option("--top <value>", "Top offset (px or %)")
    .option("--width <value>", "Crop width (px or %)")
    .option("--height <value>", "Crop height (px or %)")
    .option("--right <value>", "Right edge (px or %, alternative to --width)")
    .option("--bottom <value>", "Bottom edge (px or %, alternative to --height)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform crop image.png --left 10 --top 10 --width 100 --height 100 --out cropped.png
  eikon transform crop image.png --left 10% --top 10% --width 80% --height 80% --out cropped.png
  eikon transform crop image.png --left 50 --top 50 --right 200 --bottom 200 --out cropped.png
`)
    .action(async (image, options) => {
      await transformCropCommand(image, options);
    });

  transform
    .command("pad <image>")
    .description("Add padding around an image")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--mask <file>", "Generate inpainting mask PNG (white=inpaint, black=keep)")
    .option("--all <px>", "Padding for all sides")
    .option("--top <px>", "Top padding (overrides --all)")
    .option("--right <px>", "Right padding (overrides --all)")
    .option("--bottom <px>", "Bottom padding (overrides --all)")
    .option("--left <px>", "Left padding (overrides --all)")
    .option("--bg-color <hex>", "Padding color (default: transparent)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform pad image.png --all 20 --out padded.png
  eikon transform pad image.png --top 10 --bottom 10 --out padded.png
  eikon transform pad image.png --all 20 --bg-color "#ffffff" --out padded.jpg
  eikon transform pad image.png --left 48 --right 47 --bg-color "#FF00FF" --out padded.png --mask mask.png
`)
    .action(async (image, options) => {
      await transformPadCommand(image, options);
    });

  transform
    .command("trim <image>")
    .description("Trim transparent pixels from image edges")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--threshold <n>", "Alpha threshold 0-255 (pixels with alpha <= threshold are trimmed, default: 0)")
    .option("--top", "Trim top edge only")
    .option("--right", "Trim right edge only")
    .option("--bottom", "Trim bottom edge only")
    .option("--left", "Trim left edge only")
    .option("--padding <px>", "Keep N pixels of border after trimming")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform trim image.png --out trimmed.png
  eikon transform trim image.png --threshold 10 --out trimmed.png
  eikon transform trim image.png --top --bottom --out trimmed.png
  eikon transform trim image.png --padding 5 --out trimmed.png
`)
    .action(async (image, options) => {
      await transformTrimCommand(image, options);
    });

  transform
    .command("mask <image>")
    .description("Apply a shape mask (circle, rounded-rect, squircle) to an image")
    .requiredOption("--shape <spec>", 'Shape mask: "circle", "rounded[:<radius>]", "squircle[:<radius>]"')
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform mask icon.png --shape circle --out icon-circle.png
  eikon transform mask icon.png --shape rounded --out icon-rounded.png
  eikon transform mask icon.png --shape rounded:20 --out icon-rounded.png
  eikon transform mask icon.png --shape rounded:15% --out icon-rounded.png
  eikon transform mask icon.png --shape squircle --out icon-squircle.png
  eikon transform mask icon.png --shape squircle:25% --out icon-squircle.png
`)
    .action(async (image, options) => {
      await transformMaskCommand(image, options);
    });

  transform
    .command("shift <image>")
    .description("Shift image content by x/y offset, filling empty space with a color")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--x <px>", "Horizontal shift in pixels (positive = right, negative = left)")
    .option("--y <px>", "Vertical shift in pixels (positive = down, negative = up)")
    .option("--bg-color <hex>", "Fill color for empty space (default: transparent)")
    .option("--wrap", "Wrap content around edges instead of filling")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon transform shift image.png --x 50 --out shifted.png
  eikon transform shift image.png --x -20 --y 30 --out shifted.png
  eikon transform shift image.png --x 100 --bg-color "#ff0000" --out shifted.jpg
  eikon transform shift image.png --x 50 --y 50 --wrap --out shifted.png
`)
    .action(async (image, options) => {
      await transformShiftCommand(image, options);
    });

  const fx = program.command("fx").description("Visual effects (shadow, inner-shadow, outline, glow, blur, tint)");

  fx.command("shadow <image>")
    .description("Add a drop shadow behind opaque content")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--color <hex>", "Shadow color (default: #000000)")
    .option("--opacity <0..1>", "Shadow opacity (default: 0.5)")
    .option("--blur <px>", "Shadow blur radius / sigma (default: 10)")
    .option("--dx <px>", "Horizontal offset (default: 0)")
    .option("--dy <px>", "Vertical offset (default: 4)")
    .option("--spread <px>", "Spread / dilate radius (default: 0)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon fx shadow sprite.png --out sprite-shadow.png
  eikon fx shadow icon.png --color "#0000ff" --blur 15 --dx 5 --dy 5 --opacity 0.7 --out out.png
  eikon fx shadow logo.png --spread 3 --blur 8 --out logo-shadow.png --force
`)
    .action(async (image, options) => {
      await fxShadowCommand(image, options);
    });

  fx.command("inner-shadow <image>")
    .description("Add an inset shadow inside opaque content")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--color <hex>", "Inner shadow color (default: #000000)")
    .option("--opacity <0..1>", "Inner shadow opacity (default: 0.5)")
    .option("--blur <px>", "Inner shadow blur radius / sigma (default: 10)")
    .option("--dx <px>", "Horizontal inset offset (default: 0)")
    .option("--dy <px>", "Vertical inset offset (default: 4)")
    .option("--spread <px>", "Inset thickness / erosion radius (default: 0)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon fx inner-shadow sprite.png --out sprite-inset.png
  eikon fx inner-shadow icon.png --color "#5b3413" --blur 6 --dy 3 --opacity 0.6 --out out.png
  eikon fx inner-shadow panel.png --spread 4 --blur 10 --dx 2 --dy 2 --out panel-inset.png --force
`)
    .action(async (image, options) => {
      await fxInnerShadowCommand(image, options);
    });

  fx.command("outline <image>")
    .description("Add a colored outline around opaque content")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--color <hex>", "Outline color (default: #000000)")
    .option("--width <px>", "Outline width in pixels (default: 2)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon fx outline sprite.png --out sprite-outlined.png
  eikon fx outline icon.png --color "#ff0000" --width 4 --out out.png --force
`)
    .action(async (image, options) => {
      await fxOutlineCommand(image, options);
    });

  fx.command("glow <image>")
    .description("Add a centered outer glow around opaque content")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--color <hex>", "Glow color (default: #ffffff)")
    .option("--opacity <0..1>", "Glow opacity (default: 0.8)")
    .option("--blur <px>", "Glow blur radius / sigma (default: 10)")
    .option("--spread <px>", "Spread / dilate radius (default: 0)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon fx glow sprite.png --out sprite-glow.png
  eikon fx glow icon.png --color "#00ff00" --blur 15 --opacity 1 --out out.png --force
  eikon fx glow logo.png --spread 3 --blur 8 --out logo-glow.png
`)
    .action(async (image, options) => {
      await fxGlowCommand(image, options);
    });

  fx.command("blur <image>")
    .description("Apply gaussian blur to an image")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--sigma <n>", "Blur sigma (default: 3, minimum: 0.3)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon fx blur photo.png --out blurred.png
  eikon fx blur photo.png --sigma 10 --out blurred.png --force
`)
    .action(async (image, options) => {
      await fxBlurCommand(image, options);
    });

  fx.command("tint <image>")
    .description("Apply a color tint / colorize effect")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .requiredOption("--color <hex>", "Tint color")
    .option("--amount <0..1>", "Tint strength (default: 1.0, full colorize)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon fx tint photo.png --color "#0000ff" --out tinted.png
  eikon fx tint photo.png --color "#ff0000" --amount 0.5 --out tinted.png --force
`)
    .action(async (image, options) => {
      await fxTintCommand(image, options);
    });

  const adjust = program.command("adjust").description("Image adjustments (brightness, contrast, saturation, vibrance)");

  adjust
    .command("brightness <image>")
    .description("Adjust image brightness")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--factor <n>", "Brightness multiplier (default: 1.0, range 0..10)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon adjust brightness photo.png --factor 1.5 --out bright.png
  eikon adjust brightness photo.png --factor 0.5 --out dark.png --force
`)
    .action(async (image, options) => {
      await adjustBrightnessCommand(image, options);
    });

  adjust
    .command("contrast <image>")
    .description("Adjust image contrast")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--factor <n>", "Contrast multiplier (default: 1.0, range 0..10)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon adjust contrast photo.png --factor 1.5 --out contrast.png
  eikon adjust contrast photo.png --factor 0.5 --out low-contrast.png --force
`)
    .action(async (image, options) => {
      await adjustContrastCommand(image, options);
    });

  adjust
    .command("saturation <image>")
    .description("Adjust image saturation")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--factor <n>", "Saturation multiplier (default: 1.0, range 0..10)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon adjust saturation photo.png --factor 2 --out saturated.png
  eikon adjust saturation photo.png --factor 0 --out grayscale.png --force
`)
    .action(async (image, options) => {
      await adjustSaturationCommand(image, options);
    });

  adjust
    .command("vibrance <image>")
    .description("Adjust image vibrance (smart saturation that protects already-saturated colors)")
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--amount <n>", "Vibrance amount (default: 0.5, range -1..1)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon adjust vibrance photo.png --amount 0.8 --out vibrant.png
  eikon adjust vibrance photo.png --amount -0.5 --out muted.png --force
`)
    .action(async (image, options) => {
      await adjustVibranceCommand(image, options);
    });

  program
    .command("inpaint-mask <image>")
    .description("Generate an inpainting mask (white=inpaint, black=keep)")
    .requiredOption("--out <file>", "Output path (must be .png)")
    .option("--region <spec>", "Region to mark white (repeatable): left:<px>, right:<px>, top:<px>, bottom:<px>, border:<px>, rect:<x>,<y>,<w>,<h>", (v: string, prev: string[]) => prev.concat(v), [] as string[])
    .option("--detect <color>", "Auto-detect padding color (hex)")
    .option("--tolerance <n>", "Color match tolerance for --detect (0-255, default: 0)")
    .option("--invert", "Swap black/white")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
Examples:
  eikon inpaint-mask photo.png --region "left:48" --region "right:47" --out mask.png
  eikon inpaint-mask photo.png --region "border:50" --out mask.png
  eikon inpaint-mask photo.png --detect "#FF00FF" --out mask.png
  eikon inpaint-mask photo.png --detect "#FF00FF" --tolerance 10 --out mask.png
  eikon inpaint-mask photo.png --region "left:48" --invert --out mask.png
`)
    .action(async (image, options) => {
      await inpaintMaskCommand(image, options);
    });

  // Help command as first-class command
  program
    .command("help [command]")
    .description("Display help for [command]")
    .action((commandName) => {
      if (commandName) {
        const cmd = program.commands.find(c => c.name() === commandName);
        if (cmd) {
          cmd.help();
        } else {
          console.error(`Unknown command: ${commandName}`);
          program.help();
        }
      } else {
        program.help();
      }
    });

  return program;
}

export async function run(argv = process.argv) {
  const program = await createProgram();
  
  try {
    await program.parseAsync(argv);
  } catch (error: any) {
    const isDebug = argv.includes("--debug");
    const isJson = argv.includes("--json");

    if (error instanceof EikonError) {
      if (isJson) {
        renderJson(error.toJSON());
      } else {
        renderError(error, isDebug);
      }
      process.exit(error.exitCode);
    } else {
      const eikonError = new EikonError(error.message || String(error), ExitCode.InternalError);
      if (isJson) {
        renderJson(eikonError.toJSON());
      } else {
        renderError(eikonError, isDebug);
      }
      process.exit(ExitCode.InternalError);
    }
  }
}
