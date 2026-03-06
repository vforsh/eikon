import { Command, Option } from "commander";
import { UsageError } from "./errors";

interface SerializedArgument {
  name: string;
  description?: string;
  required: boolean;
  variadic: boolean;
  defaultValue?: unknown;
  choices?: readonly unknown[];
}

interface SerializedOption {
  name: string;
  flags: string;
  description?: string;
  short?: string;
  long?: string;
  valueRequired: boolean;
  valueOptional: boolean;
  variadic: boolean;
  mandatory: boolean;
  defaultValue?: unknown;
  defaultValueDescription?: string;
  presetArg?: unknown;
  choices?: readonly unknown[];
  negated: boolean;
}

export interface SerializedCommand {
  name: string;
  path: string[];
  fullName: string;
  description?: string;
  aliases: string[];
  usage: string;
  arguments: SerializedArgument[];
  options: SerializedOption[];
  subcommands: Array<{
    name: string;
    aliases: string[];
    description?: string;
    fullName: string;
  }>;
  output: {
    json: {
      success: {
        ok: true;
        command: string;
        note: string;
      };
      error: {
        ok: false;
        error: {
          type: string;
          code: number;
          message: string;
          hints: string[];
        };
      };
    };
  };
}

function getCommandPath(command: Command): string[] {
  const path: string[] = [];
  let current: Command | null = command;

  while (current && current.parent) {
    path.unshift(current.name());
    current = current.parent;
  }

  return path;
}

function serializeArgument(argument: any): SerializedArgument {
  return {
    name: argument.name(),
    description: argument.description,
    required: Boolean(argument.required),
    variadic: Boolean(argument.variadic),
    defaultValue: argument.defaultValue,
    choices: argument.argChoices,
  };
}

function serializeOption(option: Option): SerializedOption {
  return {
    name: option.name(),
    flags: option.flags,
    description: option.description,
    short: option.short || undefined,
    long: option.long || undefined,
    valueRequired: Boolean(option.required),
    valueOptional: Boolean(option.optional),
    variadic: Boolean(option.variadic),
    mandatory: Boolean(option.mandatory),
    defaultValue: option.defaultValue,
    defaultValueDescription: option.defaultValueDescription,
    presetArg: option.presetArg,
    choices: option.argChoices,
    negated: Boolean(option.negate),
  };
}

export function serializeCommand(command: Command): SerializedCommand {
  const path = getCommandPath(command);
  const fullName = path.length > 0 ? path.join(" ") : command.name();
  const visibleSubcommands = command.commands.filter((subcommand: any) => !subcommand._hidden);
  const visibleOptions = command.options.filter((option) => !option.hidden);

  return {
    name: path.length > 0 ? path[path.length - 1]! : command.name(),
    path,
    fullName,
    description: command.description() || undefined,
    aliases: command.aliases(),
    usage: command.usage(),
    arguments: command.registeredArguments.map(serializeArgument),
    options: visibleOptions.map(serializeOption),
    subcommands: visibleSubcommands.map((subcommand) => {
      const subcommandPath = getCommandPath(subcommand);
      return {
        name: subcommand.name(),
        aliases: subcommand.aliases(),
        description: subcommand.description() || undefined,
        fullName: subcommandPath.join(" "),
      };
    }),
    output: {
      json: {
        success: {
          ok: true,
          command: fullName,
          note: "Command-specific fields appear alongside ok and command.",
        },
        error: {
          ok: false,
          error: {
            type: "usage",
            code: 2,
            message: "Human-readable error message",
            hints: [],
          },
        },
      },
    },
  };
}

export function findCommand(program: Command, commandPath: string[] = []): Command {
  let current = program;

  for (const segment of commandPath) {
    const next = current.commands.find((candidate) => {
      return candidate.name() === segment || candidate.aliases().includes(segment);
    });

    if (!next) {
      throw new UsageError(`Unknown command: ${commandPath.join(" ")}`);
    }

    current = next;
  }

  return current;
}
