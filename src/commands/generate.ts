import { resolve, dirname, isAbsolute, parse } from "node:path";
import { mkdir } from "node:fs/promises";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload, getImageMimeType } from "../image";
import { requestImageFromPrompt } from "../openrouter";
import { AuthError, FilesystemError, NetworkError, UsageError } from "../errors";
import { renderJson, renderPlain } from "../output";

const DEFAULT_MODEL = "google/gemini-3-pro-image-preview";
const MAX_REF_BYTES = 20 * 1024 * 1024;

export interface GenerateOptions {
  prompt?: string;
  ref?: string;
  outDir?: string;
  name?: string;
  force?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  model?: string;
  apiKeyFile?: string;
  apiKeyStdin?: boolean;
  timeout?: string;
}

function formatPlain(result: {
  outPath: string;
  mime: string;
  bytes: number;
  model: string;
  ref?: { type: "file" | "url"; value: string };
}) {
  const lines = [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Model: ${result.model}`,
  ];
  if (result.ref) {
    const prefix = result.ref.type === "file" ? "file:" : "url:";
    lines.push(`Ref: ${prefix}${result.ref.value}`);
  }
  return lines.join("\n");
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function defaultFilename(now = new Date()) {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return `eikon-${y}${m}${d}-${hh}${mm}${ss}.png`;
}

function withSuffix(baseName: string, index: number) {
  const parsed = parse(baseName);
  return `${parsed.name}-${index}${parsed.ext}`;
}

async function resolveOutputPath(
  outDir: string,
  name: string | undefined,
  force: boolean | undefined,
): Promise<string> {
  if (name && (name.includes("/") || name.includes("\\"))) {
    throw new UsageError("Invalid --name: must be a filename, not a path.");
  }

  const baseName = name || defaultFilename();
  let outPath = resolve(outDir, baseName);
  const outFile = Bun.file(outPath);

  if (await outFile.exists()) {
    if (force) {
      return outPath;
    }

    if (name) {
      throw new FilesystemError(`Output already exists: ${outPath}`, ["Pass --force to overwrite."]);
    }

    for (let i = 2; i <= 999; i += 1) {
      const candidate = resolve(outDir, withSuffix(baseName, i));
      if (!(await Bun.file(candidate).exists())) {
        return candidate;
      }
    }

    throw new FilesystemError(`Unable to find available output name in: ${outDir}`);
  }

  return outPath;
}

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function fetchReferenceImage(refUrl: string, timeoutMs: number) {
  let url: URL;
  try {
    url = new URL(refUrl);
  } catch {
    throw new UsageError(`Invalid --ref URL: ${refUrl}`);
  }

  if (url.protocol === "http:" && !isLocalhost(url.hostname)) {
    throw new UsageError("--ref URL must be https:// (http:// only allowed for localhost).");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError("--ref URL must start with http:// or https://.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(refUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new NetworkError(`Failed to fetch reference image: ${response.status} ${response.statusText}`);
    }

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader) {
      const length = Number(lengthHeader);
      if (Number.isFinite(length) && length > MAX_REF_BYTES) {
        throw new UsageError(`Reference image exceeds ${MAX_REF_BYTES} bytes.`);
      }
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    let mimeType: string | undefined;
    if (contentType) {
      if (!contentType.startsWith("image/")) {
        throw new UsageError("Reference URL did not return an image.");
      }
      mimeType = contentType;
    } else {
      mimeType = getImageMimeType(url.pathname);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REF_BYTES) {
      throw new UsageError(`Reference image exceeds ${MAX_REF_BYTES} bytes.`);
    }

    return {
      mimeType,
      imageBase64: buffer.toString("base64"),
    };
  } catch (error: any) {
    if (error instanceof NetworkError || error instanceof UsageError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new NetworkError("Reference image fetch timed out.");
    }

    throw new NetworkError(`Failed to fetch reference image: ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/xcAAn8B9nL8rW0AAAAASUVORK5CYII=";

export async function generateCommand(opts: GenerateOptions) {
  const startTime = Date.now();

  const prompt = (opts.prompt || "").trim();
  if (!prompt) {
    throw new UsageError("Missing --prompt.", ["Provide --prompt with a non-empty value."]);
  }

  if (!opts.outDir) {
    throw new UsageError("Missing --out-dir.", ["Provide --out-dir PATH."]);
  }

  let apiKey: string | undefined;
  if (opts.apiKeyStdin) {
    apiKey = (await Bun.stdin.text()).trim();
  } else if (opts.apiKeyFile) {
    const file = Bun.file(opts.apiKeyFile);
    if (await file.exists()) {
      apiKey = (await file.text()).trim();
    } else {
      throw new AuthError(`API key file not found: ${opts.apiKeyFile}`);
    }
  }

  const config = await getEffectiveConfig({
    apiKey,
    model: opts.model,
    timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
  });

  if (!config.apiKey) {
    throw new AuthError("Missing API key.", [
      "Set OPENROUTER_API_KEY, or run: eikon config init",
      "Or pass --api-key-file PATH / --api-key-stdin"
    ]);
  }

  let ref:
    | {
        type: "file" | "url";
        value: string;
        mimeType: string;
        imageBase64: string;
      }
    | undefined;
  let refFetchMs: number | undefined;

  if (opts.ref) {
    const refValue = opts.ref.trim();
    if (!refValue) {
      throw new UsageError("Invalid --ref: empty value.");
    }

    const refStart = Date.now();
    if (isHttpUrl(refValue)) {
      const fetched = await fetchReferenceImage(refValue, config.timeoutMs || 30000);
      ref = { type: "url", value: refValue, ...fetched };
    } else {
      if (!isAbsolute(refValue)) {
        throw new UsageError("--ref path must be absolute.");
      }
      const processed = await prepareImageForUpload({ imagePath: refValue });
      ref = {
        type: "file",
        value: refValue,
        mimeType: processed.mimeType,
        imageBase64: processed.imageBase64,
      };
    }
    refFetchMs = Date.now() - refStart;
  }

  const requestStart = Date.now();
  let outputBytes: Buffer;
  let outputMime = "image/png";

  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    if (ref) {
      outputBytes = Buffer.from(ref.imageBase64, "base64");
      outputMime = ref.mimeType;
    } else {
      outputBytes = Buffer.from(MOCK_PNG_BASE64, "base64");
      outputMime = "image/png";
    }
  } else {
    const response = await requestImageFromPrompt({
      apiKey: config.apiKey,
      model: config.model || DEFAULT_MODEL,
      prompt,
      ref: ref ? { mimeType: ref.mimeType, imageBase64: ref.imageBase64 } : undefined,
      timeoutMs: config.timeoutMs,
    });
    outputBytes = response.bytes;
    outputMime = response.mimeType;
  }

  const requestMs = Date.now() - requestStart;
  const totalMs = Date.now() - startTime;

  const outDir = resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });
  const outPath = await resolveOutputPath(outDir, opts.name?.trim() || undefined, opts.force);

  if ((await Bun.file(outPath).exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, ["Pass --force to overwrite."]);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, outputBytes);

  const result = {
    ok: true,
    outPath,
    mime: outputMime,
    bytes: outputBytes.length,
    model: config.model || DEFAULT_MODEL,
    ref: ref ? { type: ref.type, value: ref.value } : undefined,
    timingMs: {
      total: totalMs,
      request: requestMs,
      ...(refFetchMs !== undefined ? { refFetch: refFetchMs } : {}),
    },
  };

  if (opts.json) {
    renderJson(result);
  } else if (opts.plain) {
    renderPlain(formatPlain(result));
  } else if (!opts.quiet) {
    renderPlain(formatPlain(result));
  }
}
