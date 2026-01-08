import { EikonError } from "./errors";

export interface AnalysisResult {
  ok: true;
  text: string;
  meta: {
    model: string;
    preset?: string;
    image: {
      path: string;
      mime: string;
      original?: { width: number; height: number };
      processed?: { width: number; height: number; resized: boolean };
    };
    timingMs: {
      total: number;
      uploadPrep: number;
      request: number;
    };
  };
}

export type EikonOutput = AnalysisResult | ReturnType<EikonError["toJSON"]>;

export function renderHuman(text: string) {
  process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
}

export function renderPlain(text: string) {
  process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
}

export function renderJson(data: any) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function renderError(error: EikonError | Error, debug = false) {
  if (error instanceof EikonError) {
    process.stderr.write(`error: ${error.message}\n`);
    for (const hint of error.hints) {
      process.stderr.write(`hint: ${hint}\n`);
    }
    if (debug && error.stack) {
      process.stderr.write(`\n${error.stack}\n`);
    }
  } else {
    process.stderr.write(`error: ${error.message}\n`);
    if (debug && error.stack) {
      process.stderr.write(`\n${error.stack}\n`);
    }
  }
}

export async function handleOutputPolicy(
  result: AnalysisResult,
  opts: {
    json?: boolean;
    plain?: boolean;
    output?: string;
    quiet?: boolean;
  }
) {
  if (opts.output) {
    await Bun.write(opts.output, result.text);
  }

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(result.text);
  } else if (!opts.quiet || !opts.output) {
    renderHuman(result.text);
  }
}
