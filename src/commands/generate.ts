import { resolve, dirname, isAbsolute, parse } from "node:path";
import { mkdir } from "node:fs/promises";
import { getEffectiveConfig } from "../config";
import { prepareImageForUpload, getImageMimeType } from "../image";
import { requestImageFromPrompt } from "../openrouter";
import { AuthError, NetworkError, UsageError } from "../errors";
import { renderJson, renderPlain } from "../output";

const DEFAULT_MODEL = "google/gemini-3-pro-image-preview";
const MAX_REF_BYTES = 20 * 1024 * 1024;

export interface GenerateOptions {
  prompt?: string;
  ref?: string[];
  out?: string;
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
  refs?: { type: "file" | "url"; value: string }[];
}) {
  const lines = [
    `Path: ${result.outPath}`,
    `MIME: ${result.mime}`,
    `Bytes: ${result.bytes}`,
    `Model: ${result.model}`,
  ];
  if (result.refs && result.refs.length > 0) {
    for (const ref of result.refs) {
      const prefix = ref.type === "file" ? "file:" : "url:";
      lines.push(`Ref: ${prefix}${ref.value}`);
    }
  }
  return lines.join("\n");
}

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function resolveOutputPath(outPath: string, force?: boolean) {
  if (force) {
    return { path: outPath, warned: false };
  }

  if (!(await Bun.file(outPath).exists())) {
    return { path: outPath, warned: false };
  }

  const parsed = parse(outPath);
  const match = parsed.name.match(/^(.*)_(\d+)$/);
  const baseName = match ? match[1] : parsed.name;
  let index = match ? Number(match[2]) + 1 : 2;

  if (!Number.isFinite(index) || index < 2) {
    index = 2;
  }

  while (true) {
    const candidate = resolve(parsed.dir, `${baseName}_${index}${parsed.ext}`);
    if (!(await Bun.file(candidate).exists())) {
      return { path: candidate, warned: true };
    }
    index += 1;
  }
}

async function fetchReferenceImage(refUrl: string, timeoutMs: number) {
  const testRefPath = process.env.EIKON_TEST_REF_PATH;
  if (testRefPath && process.env.EIKON_MOCK_OPENROUTER === "1") {
    const file = Bun.file(testRefPath);
    if (!(await file.exists())) {
      throw new UsageError(`Test reference image not found: ${testRefPath}`);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    return {
      mimeType: getImageMimeType(testRefPath),
      imageBase64: buffer.toString("base64"),
    };
  }

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

  if (!opts.out) {
    throw new UsageError("Missing --out.", ["Provide --out PATH."]);
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
    generateModel: opts.model,
    timeoutMs: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
  });

  if (!config.apiKey) {
    throw new AuthError("Missing API key.", [
      "Set OPENROUTER_API_KEY, or run: eikon config init",
      "Or pass --api-key-file PATH / --api-key-stdin"
    ]);
  }

  const refs: {
    type: "file" | "url";
    value: string;
    mimeType: string;
    imageBase64: string;
  }[] = [];
  let refFetchMs: number | undefined;

  const refInputs = opts.ref ?? [];
  if (refInputs.length > 0) {
    const refStart = Date.now();
    for (const refValue of refInputs) {
      const trimmed = refValue.trim();
      if (!trimmed) {
        throw new UsageError("Invalid --ref: empty value.");
      }

      if (isHttpUrl(trimmed)) {
        const fetched = await fetchReferenceImage(trimmed, config.timeoutMs || 30000);
        refs.push({ type: "url", value: trimmed, ...fetched });
      } else {
        if (!isAbsolute(trimmed)) {
          throw new UsageError("--ref path must be absolute.");
        }
        const processed = await prepareImageForUpload({ imagePath: trimmed });
        refs.push({
          type: "file",
          value: trimmed,
          mimeType: processed.mimeType,
          imageBase64: processed.imageBase64,
        });
      }
    }
    refFetchMs = Date.now() - refStart;
  }

  const requestStart = Date.now();
  let outputBytes: Buffer;
  let outputMime = "image/png";

  if (process.env.EIKON_MOCK_OPENROUTER === "1") {
    const firstRef = refs[0];
    if (firstRef) {
      outputBytes = Buffer.from(firstRef.imageBase64, "base64");
      outputMime = firstRef.mimeType;
    } else {
      outputBytes = Buffer.from(MOCK_PNG_BASE64, "base64");
      outputMime = "image/png";
    }
  } else {
    const response = await requestImageFromPrompt({
      apiKey: config.apiKey,
      model: config.generateModel || config.model || DEFAULT_MODEL,
      prompt,
      refs: refs.length > 0 ? refs.map((r) => ({ mimeType: r.mimeType, imageBase64: r.imageBase64 })) : undefined,
      timeoutMs: config.timeoutMs,
    });
    outputBytes = response.bytes;
    outputMime = response.mimeType;
  }

  const requestMs = Date.now() - requestStart;
  const totalMs = Date.now() - startTime;

  const requestedOutPath = resolve(opts.out);
  const resolvedOut = await resolveOutputPath(requestedOutPath, opts.force);

  if (resolvedOut.warned) {
    process.stderr.write(`warning: Output already exists, saving as: ${resolvedOut.path}\n`);
  }

  await mkdir(dirname(resolvedOut.path), { recursive: true });
  await Bun.write(resolvedOut.path, outputBytes);

  const result = {
    ok: true,
    outPath: resolvedOut.path,
    mime: outputMime,
    bytes: outputBytes.length,
    model: config.generateModel || config.model || DEFAULT_MODEL,
    refs: refs.length > 0 ? refs.map((r) => ({ type: r.type, value: r.value })) : undefined,
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
