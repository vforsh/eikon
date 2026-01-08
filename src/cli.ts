import { Command } from "commander";
import { analyzeCommand } from "./commands/analyze";
import { presetsListCommand, presetsShowCommand } from "./commands/presets";
import { configInitCommand, configPathCommand, configShowCommand } from "./commands/config";
import { analyzeLocalCommand } from "./commands/analyze_local";
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
