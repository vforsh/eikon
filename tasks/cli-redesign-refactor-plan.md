# Eikon CLI redesign/refactor plan (no backward-compat constraints)

This document is an executable plan for redesigning `eikon` to follow modern CLI best practices (human-first, composable, robust) per the CLI Guidelines:

- Source: [Command Line Interface Guidelines](https://raw.githubusercontent.com/steipete/agent-scripts/main/skills/create-cli/references/cli-guidelines.md)

Scope: redesign the public interface **freely** (we do **not** preserve backward compatibility). Prioritize correctness, discoverability, and scriptability.

---

## Goals (what “good” looks like)

- **Human-first**:
  - `--help` is examples-first and task-oriented.
  - errors are actionable and do not dump stack traces by default.
  - “say (just) enough”: success output is brief, verbose/debug output is opt-in.
- **Composable**:
  - primary results go to **stdout**, diagnostics to **stderr**.
  - machine-readable modes exist and are stable (`--json`, `--plain`).
  - predictable exit codes.
- **Robust**:
  - validate early, fail fast.
  - handle missing/invalid files, config errors, and network issues consistently.
  - avoid interactivity unless stdin is a TTY; provide non-interactive flags.
- **Secure by default**:
  - avoid secrets in flags.
  - support reading secrets from stdin or files.

Non-goals:
- Backward compatibility (flags/subcommands can change).
- Full-screen TUI.

---

## Proposed CLI surface (final target)

### Command tree

```
eikon <command> [options]

Commands:
  analyze   Analyze an image with a prompt/preset (default command)
  presets   List/show prompt presets
  config    Manage config (init/show/path)
  help      Show help for a command
```

Notes:
- Default invocation runs `analyze` if no command is provided (optional; decide based on preference).
- `help` exists as a first-class command: `eikon help`, `eikon help analyze`, etc.

---

## I/O + contracts (the “CLI ABI”)

### Stdout/stderr rules

- **stdout**: primary output (the “result”), especially in `--plain` and `--json` modes.
- **stderr**: diagnostics (errors, warnings, progress/status), never required to parse for success.

### Output modes

Output modes are mutually exclusive:
- **Default (human)**: prints human-friendly result text to stdout. Minimal extra chatter.
- **`--plain`**: stable, line-oriented output (suitable for piping). No decorations.
- **`--json`**: stable JSON schema to stdout (suitable for tooling).

### Exit codes (standardized)

Use these exit codes across all commands:
- `0`: success
- `2`: usage / validation error (bad flags, missing args, unknown preset, invalid resize spec)
- `3`: configuration error (unreadable config, invalid TOML)
- `4`: authentication error (missing/invalid API key)
- `5`: filesystem error (image missing/unreadable, output path issues)
- `6`: dependency error (optional dependency missing for requested feature, e.g. `sharp` needed)
- `7`: network/API error (timeouts, non-2xx, OpenRouter/OpenAI client errors)
- `8`: unexpected internal error (bug). In `--debug`, include stack trace.

### Error rendering rules

- Default: a single-line message with optional hint(s), written to **stderr**.
- `--json`: also emit a JSON error object to **stdout** (still exit non-zero).
- `--debug`: include extra diagnostic context (stack traces, error causes, request ids).

Example default error format (stderr):

```
error: Missing API key.
hint: Set OPENROUTER_API_KEY, or run: eikon config init
hint: Or pass --api-key-file PATH / --api-key-stdin
```

Example `--json` error object (stdout):

```json
{
  "ok": false,
  "error": {
    "type": "auth",
    "code": 4,
    "message": "Missing API key.",
    "hints": [
      "Set OPENROUTER_API_KEY, or run: eikon config init",
      "Or pass --api-key-file PATH / --api-key-stdin"
    ]
  }
}
```

---

## Command specs

### `eikon analyze <image> [prompt...]`

Analyze an image using a vision model with either:
- inline prompt (positional tail)
- or a preset (`--preset <name>`)
- or prompt from stdin (`--prompt-stdin`)

#### Arguments
- `<image>`: required path to PNG/JPG/WebP.
- `[prompt...]`: optional prompt fragments, joined by spaces.

#### Flags

Output:
- `--plain`: stable plain-text output
- `--json`: JSON output
- `-o, --output <file>`: write primary result to file (still allow stdout optionally; see “output to file” policy below)
- `--quiet`: suppress non-error diagnostics
- `--verbose`: more diagnostics
- `--debug`: maximum diagnostics (including stack traces on unexpected errors)
- `--no-color`: disable color

Model + prompt selection:
- `-m, --model <id>`: OpenRouter model ID
- `--preset <name>`: use named preset prompt
- `--prompt-stdin`: read prompt text from stdin

Auth:
- `--api-key-file <path>`: read API key from file (trim whitespace)
- `--api-key-stdin`: read API key from stdin (trim whitespace)

Image processing:
- `--downsize`: downsize to a default max (e.g. 2048x2048)
- `--max-width <px|x0.5>`: downsize constraint
- `--max-height <px|x0.5>`: downsize constraint

Network:
- `--timeout <ms>`: request timeout

#### Output to file policy (pick one and enforce consistently)

Recommended policy:
- If `--output <file>` is provided:
  - **still write the primary result to stdout** (so piping remains easy), unless `--quiet` is set.
  - additionally write the exact primary result bytes to the file.
- Alternative policy:
  - if `--output` is provided, stdout is empty (current behavior).

Pick one policy and document it. The “recommended” option is more composable; the “alternative” is sometimes preferred for scripting. Either is fine if stable.

#### JSON schema (success)

```json
{
  "ok": true,
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

Notes:
- Always include `ok`.
- Include `meta.image.original/processed` when available; if image metadata can’t be read, omit or set null.
- Ensure JSON is stable and additive over time.

---

### `eikon presets list`

Lists available presets.

Output:
- default: one per line (human + pipe-friendly)
- `--json`: array of preset objects

Example plain output:

```
web-ui
```

### `eikon presets show <name>`

Prints the full preset prompt to stdout (so it can be piped).

Flags:
- `--json`: `{ ok: true, name, content }`

---

### `eikon config init`

Creates a default config file in user config dir.

Flags:
- `--force`: overwrite
- `--print`: print the resulting path
- `--json`: emit `{ ok, path, created, overwritten }`

Never prompt unless stdin is a TTY; add `--no-input` to force no prompts (though this command may be non-interactive by design).

### `eikon config path`

Print the effective config path (stdout).

### `eikon config show`

Print the effective config after applying precedence (stdout).

Flags:
- `--json`
- Always redact secrets (e.g. show `"apiKey": "********"` or omit).

---

## Configuration & environment variables

### Config precedence

High → low precedence:
1. flags
2. env vars
3. config file

### Config location

Keep `~/.config/eikon/config.toml` (good default on macOS/Linux). Consider XDG rules later if needed.

### Config keys

```toml
apiKey = "sk-or-..."
model = "google/gemini-3-flash-preview"
timeoutMs = 30000
```

### Environment variables

- `OPENROUTER_API_KEY`: API key (string)
- `OPENROUTER_MODEL`: default model
- `EIKON_TIMEOUT_MS`: default timeout override
- `NO_COLOR`: disable color output

Avoid “secret via env” by default is a guideline, but API keys via env are common and acceptable if documented.

---

## Implementation refactor plan (step-by-step)

This section is the actual execution checklist.

### Step 1 — Introduce a small internal architecture

Create a `src/` layout and move logic out of `index.ts`:

- `src/cli.ts`
  - Commander program definition (commands, flags, help).
- `src/commands/analyze.ts`
  - validate args
  - resolve prompt
  - resolve auth
  - image prep
  - call OpenRouter
  - return a structured result
- `src/commands/presets.ts`
  - list/show
- `src/commands/config.ts`
  - init/path/show
- `src/config.ts`
  - load/parse config
  - compute effective config with precedence
- `src/image.ts`
  - mime detection
  - resizing helpers
  - metadata extraction (width/height)
- `src/openrouter.ts`
  - OpenAI client wrapper
  - request timeout
  - map API errors to internal errors
- `src/output.ts`
  - render human/plain/json
  - handle `--output` file writing policy
- `src/errors.ts`
  - typed errors + `exitCode`
  - serialization to JSON
  - rendering for stderr
- `src/env.ts`
  - centralized env var parsing/validation

Keep `index.ts` as the executable entrypoint that calls `src/cli.ts`.

Acceptance:
- `bun ./index.ts --help` works.
- `bun ./index.ts analyze --help` works.

### Step 2 — Standardize errors and exit mapping

Implement typed errors and a single top-level error handler:
- Validate early with guard clauses (return early).
- No `process.exit()` scattered throughout helpers.
- One exit path in CLI runner:
  - success → exit 0
  - typed error → render + exit mapped code
  - unknown error → render generic + exit 8 (include stack trace only in `--debug`)

Acceptance:
- invalid resize spec exits `2`
- missing api key exits `4`
- missing image exits `5`
- missing optional dependency for resize exits `6`

### Step 3 — Finalize output modes

Implement:
- `--plain`
- `--json` (success + error objects)

Acceptance:
- stdout is exactly the primary output; stderr contains only diagnostics
- `--json` always prints valid JSON on stdout

### Step 4 — Implement `presets` and `config` command families

- `eikon presets list|show`
- `eikon config init|path|show`

Acceptance:
- `eikon presets list --plain` is one per line
- `eikon config show --json` redacts secrets

### Step 5 — Make auth safe and flexible

Replace `--api-key <key>` with:
- `--api-key-file`
- `--api-key-stdin`

Also allow `OPENROUTER_API_KEY`.

Acceptance:
- `cat key.txt | eikon analyze ... --api-key-stdin` works

### Step 6 — Add timeouts + improve network error messages

- `--timeout <ms>` and config/env equivalents
- map timeouts to exit code `7`

Acceptance:
- timeout yields a concise actionable message and `7`

---

## Help text design guidelines (concrete)

Every command help should:
- Start with **Examples** (3–6).
- Then show Usage line(s).
- Then show argument descriptions.
- Then flags grouped by category.

When usage fails (missing args, unknown preset, etc):
- Print `error: …` and 1–2 example invocations.
- Print `hint: Use --help` or `hint: eikon help <command>`.

---

## Testing plan (update `tests/e2e.test.ts`)

Rewrite tests to match the new CLI contracts:

- **Help/discovery**
  - `eikon --help` includes “Examples” and lists commands.
  - `eikon help analyze` prints analyze help.
- **Exit codes**
  - missing image → `5`
  - invalid resize spec → `2`
  - missing API key → `4`
- **Output separation**
  - success: stdout has result; stderr is empty (unless `--verbose`)
  - errors: stderr has message; stdout empty unless `--json`
- **JSON stability**
  - `--json` success returns `{ ok: true, text, meta }`
  - `--json` error returns `{ ok: false, error: { code, type, ... } }`

Keep a minimal mocking hook (like `EIKON_MOCK_OPENROUTER=1`) but ensure it does not leak into normal UX.

---

## Open questions (decide before implementing)

1. Default command behavior:
   - A) `eikon analyze` as default when no command is provided
   - B) require explicit command (clearer, more scalable)
2. `--output` policy:
   - A) still write to stdout (recommended for composition)
   - B) suppress stdout when `--output` is set
3. Should `analyze` require an explicit prompt source?
   - A) allow empty prompt if preset provided (current behavior)
   - B) always require some prompt source, but ship a default preset and use it automatically (human-friendly)

---

## Definition of Done

- All commands follow stdout/stderr rules.
- `--plain` and `--json` are stable and documented.
- Exit codes are standardized and covered by tests.
- Help is examples-first and actionable on errors.
- No secrets are encouraged via flags; file/stdin supported.

