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
   eikon generate --prompt "Minimal icon of a cat" --out-dir ./out
   eikon presets list --plain
   eikon config init
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

  const generate = program
    .command("generate")
    .description("Generate an image from a text prompt")
    .option("--prompt <text>", "Text prompt")
    .option("--out-dir <dir>", "Output directory")
    .option("--ref <abs-path|https-url>", "Reference image (absolute path or https URL)")
    .option("--name <file>", "Output filename (within --out-dir)")
    .option("--force", "Overwrite if output exists")
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
    eikon generate --prompt "Minimal icon of a cat" --out-dir ./out
    eikon generate --prompt "Same style, new pose" --ref /abs/path/ref.png --out-dir ./out
    eikon generate --prompt "Use this as composition reference" --ref https://example.com/ref.png --out-dir ./out --json
    eikon generate models
    eikon generate models --json
`)
    .action(async (options) => {
      await generateCommand(options);
    });

  generate
    .command("models")
    .description("List OpenRouter models that support image generation")
    .option("--json", "Output JSON array of model IDs")
    .option("--api-key-file <path>", "Read API key from file (only if required)")
    .option("--api-key-stdin", "Read API key from stdin (only if required)")
    .option("--timeout <ms>", "Request timeout in ms")
    .addHelpText("before", `
  Examples:
    eikon generate models
    eikon generate models --json
`)
    .action(async (options) => {
      await generateModelsCommand(options);
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
