import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze";
import { saveCommand } from "./commands/save";
import { presetsListCommand, presetsShowCommand } from "./commands/presets";
import { configInitCommand, configPathCommand, configShowCommand } from "./commands/config";
import { analyzeLocalCommand } from "./commands/analyze_local";
import { upscaleCommand } from "./commands/upscale";
import { upscaleLocalCommand } from "./commands/upscale_local";
import { generateCommand } from "./commands/generate";
import { generateModelsCommand } from "./commands/generate_models";
import { placeholderCommand } from "./commands/placeholder";
import { composeCommand } from "./commands/compose";
import { editCommand } from "./commands/edit";
import { editModelsCommand } from "./commands/edit_models";
import { openrouterGuardrailsCommand, openrouterKeysCommand } from "./commands/openrouter";
import { aiRemoveBgCommand } from "./commands/ai_remove_bg";
import { aiExtendCommand } from "./commands/ai_extend";
import { aiVariationsCommand } from "./commands/ai_variations";
import { aiDescribeCommand } from "./commands/ai_describe";
import { atlasSplitCommand } from "./commands/atlas_split";
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
   eikon upscale screenshot.png --out screenshot@2x.png
   eikon upscale:local screenshot.png --out screenshot@2x.png --scale 2
   eikon generate --prompt "Minimal icon of a cat" --out ./cat.png
   eikon edit photo.png --prompt "Remove background" --out photo-nobg.png
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
    .command("upscale")
    .description("Upscale an image via OpenRouter image-edit models")
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
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
  Examples:
    eikon upscale screenshot.png --out screenshot@2x.png
    eikon upscale screenshot.png --out screenshot@2x.png --scale 4
    eikon upscale screenshot.png --out screenshot@2x.png --width 2400
    eikon upscale screenshot.png --out screenshot@2x.png --api-key-file .key --json
`)
    .action(async (image, options) => {
      await upscaleCommand(image, options);
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
    .option("--no-text-outline", "Disable text outline")
    .option("--text-outline-color <color>", "Text outline color (hex)")
    .option("--text-outline-width <px>", "Text outline width in pixels")
    .option("--no-text-shadow", "Disable text shadow")
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
    eikon placeholder --w 800 --h 400 --bg-color "#111827" --text "Line 1\\nLine 2" --no-text-shadow --out out.png
`)
    .action(async (options) => {
      await placeholderCommand(options);
    });

  program
    .command("compose")
    .description("Compose multiple images with configurable opacity and blend modes")
    .option("--layer <spec>", "Layer: <path>[:<opacity>][:<blend>] (repeatable, first is base)", (value: string, prev: string[]) => prev.concat(value), [] as string[])
    .requiredOption("--out <file>", "Output path (extension determines format)")
    .option("--width <px>", "Override output width")
    .option("--height <px>", "Override output height")
    .option("--bg-color <hex>", "Background color for transparent areas")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error output")
    .option("--no-color", "Disable color")
    .addHelpText("before", `
  Examples:
    eikon compose --layer base.png --layer overlay.png --out result.png
    eikon compose --layer bg.png --layer fg.png:0.7 --out result.png
    eikon compose --layer a.png --layer b.png::multiply --out out.png
    eikon compose --layer a.png --layer b.png:0.5:screen --layer c.png:0.7 --out out.png
    eikon compose --layer transparent.png --layer top.png --bg-color "#fff" --out result.jpg
`)
    .action(async (options) => {
      await composeCommand(options);
    });

  const edit = program
    .command("edit")
    .description("Edit an image using AI with natural language instructions")
    .argument("[image]", "Path to image file (png/jpg/webp)")
    .option("--out <file>", "Output path for the edited image")
    .option("--prompt <text>", "Edit prompt (what to change)")
    .option("--prompt-stdin", "Read prompt from stdin")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
  Examples:
    eikon edit photo.png --prompt "Remove the background" --out photo-nobg.png
    eikon edit ui.png --prompt "Change the button color to blue" --out ui-blue.png
    eikon edit screenshot.png --prompt "Blur the email addresses" --out redacted.png
    echo "Make it warmer" | eikon edit photo.png --prompt-stdin --out warm.png
    eikon edit models
`)
    .action(async (image, options) => {
      await editCommand(image, options);
    });

  const generate = program
    .command("generate")
    .description("Generate an image from a text prompt")
    .option("--prompt <text>", "Text prompt")
    .option("--out <file>", "Output path for the image")
    .option("--ref <abs-path|https-url>", "Reference image (absolute path or https URL, repeatable)", (value: string, prev: string[]) => prev.concat(value), [] as string[])
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
  Examples:
    eikon generate --prompt "Minimal icon of a cat" --out ./cat.png
    eikon generate --prompt "Same style, new pose" --ref /abs/path/ref.png --out ./out.png
    eikon generate --prompt "Combine these images" --ref /path/img1.png --ref /path/img2.png --out ./combined.png
    eikon generate --prompt "Use this as composition reference" --ref https://example.com/ref.png --out ./out.png --json
    eikon generate models
    eikon generate models --json
    eikon generate models --supports-ref
`)
    .action(async (options) => {
      await generateCommand(options);
    });

  generate
    .command("models")
    .description("List OpenRouter models that support image generation")
    .option("--json", "Output JSON array of model IDs")
    .option("--details", "Show concise model metadata")
    .option("--supports-ref", "Filter models that accept image references")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
  Examples:
    eikon generate models
    eikon generate models --json
    eikon generate models --details
    eikon generate models --supports-ref
`)
    .action(async (options) => {
      await generateModelsCommand(options);
    });

  edit
    .command("models")
    .description("List OpenRouter models that support image editing")
    .option("--json", "Output JSON array of model IDs")
    .option("--details", "Show concise model metadata")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
  Examples:
    eikon edit models
    eikon edit models --json
    eikon edit models --details
`)
    .action(async (options) => {
      await editModelsCommand(options);
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

  const ai = program.command("ai").description("AI-powered image operations");

  ai.command("remove-bg <image>")
    .description("Remove background from an image (outputs transparent PNG)")
    .requiredOption("--out <file>", "Output path (.png required for transparency)")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
Examples:
  eikon ai remove-bg photo.png --out photo-nobg.png
  eikon ai remove-bg sprite.png --out sprite-nobg.png --json
`)
    .action(async (image, options) => {
      await aiRemoveBgCommand(image, options);
    });

  ai.command("extend <image>")
    .description("Extend an image in specified direction(s)")
    .requiredOption("--out <file>", "Output path for the extended image")
    .option("--direction <dir>", "Direction: up, down, left, right, all (default: all)")
    .option("--pixels <n>", "Pixels to extend (default: 256)")
    .option("--prompt <text>", "Optional description for the extended area")
    .option("--force", "Overwrite if --out exists")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
Examples:
  eikon ai extend landscape.jpg --out wider.jpg --direction right --pixels 512
  eikon ai extend scene.png --out scene-ext.png --direction all --prompt "continue the forest"
`)
    .action(async (image, options) => {
      await aiExtendCommand(image, options);
    });

  ai.command("variations <image>")
    .description("Generate variations of an image")
    .requiredOption("--out <file>", "Output path (will be numbered: name_1.ext, name_2.ext, ...)")
    .option("-n, --count <n>", "Number of variations (default: 4, max: 10)")
    .option("--prompt <text>", "Optional style guidance")
    .option("--force", "Overwrite if outputs exist")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
Examples:
  eikon ai variations logo.png --out logo-var.png -n 4
  eikon ai variations photo.jpg --out photo-var.jpg --prompt "different lighting"
`)
    .action(async (image, options) => {
      await aiVariationsCommand(image, options);
    });

  ai.command("describe <image>")
    .description("Describe an image using AI")
    .option("--detail <level>", "Detail level: brief, standard, detailed (default: standard)")
    .option("--focus <area>", "Focus area: composition, colors, objects, text, all (default: all)")
    .option("-o, --output <file>", "Write description to file")
    .option("--json", "Output JSON")
    .option("--plain", "Stable plain-text output")
    .option("--quiet", "Suppress non-error diagnostics")
    .option("--no-color", "Disable color")
    .option("-m, --model <id>", "OpenRouter model ID")
    .option("--api-key-file <path>", "Read API key from file")
    .option("--api-key-stdin", "Read API key from stdin")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
Examples:
  eikon ai describe screenshot.png
  eikon ai describe ui.png --detail detailed --focus composition
  eikon ai describe photo.png -o description.txt --json
`)
    .action(async (image, options) => {
      await aiDescribeCommand(image, options);
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

export async function run() {
  const program = await createProgram();
  
  try {
    await program.parseAsync();
  } catch (error: any) {
    const isDebug = process.argv.includes("--debug");
    const isJson = process.argv.includes("--json");

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
