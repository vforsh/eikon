import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { UsageError, FilesystemError } from "../errors";
import { getImageInfoFromBuffer } from "../image";
import { renderPlain, renderJson } from "../output";

export interface SaveOptions {
  input?: string;
  out: string;
  force?: boolean;
  json?: boolean;
}

export async function saveCommand(opts: SaveOptions) {
  // Input selection
  let inputText: string;
  if (opts.input) {
    const inputFile = Bun.file(opts.input);
    if (!(await inputFile.exists())) {
      throw new FilesystemError(`Input file not found: ${opts.input}`);
    }
    inputText = await inputFile.text();
  } else {
    inputText = await Bun.stdin.text();
  }

  if (!inputText.trim()) {
    throw new UsageError("Provide --input PATH or pipe text into stdin.");
  }

  // Data URL extraction
  // Regex: data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+
  const markerRegex = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
  const matches = Array.from(inputText.matchAll(markerRegex));

  if (matches.length === 0) {
    throw new UsageError("Expected a data:image/*;base64, payload in input");
  }

  if (matches.length > 1) {
    throw new UsageError(`Expected exactly one image data URL in input, found ${matches.length}`);
  }

  const match = matches[0];
  if (!match) {
    throw new UsageError("Expected a data:image/*;base64, payload in input");
  }

  const [_fullMatch, type, b64] = match;
  if (!type || !b64) {
    throw new UsageError("Failed to parse image data URL");
  }
  const mime = `image/${type}`;
  const buffer = Buffer.from(b64, "base64");

  if (buffer.length === 0) {
    throw new UsageError("Failed to decode base64 image payload");
  }

  // Output file writing
  const outPath = resolve(opts.out);
  const outFile = Bun.file(outPath);

  if ((await outFile.exists()) && !opts.force) {
    throw new FilesystemError(`Output already exists: ${outPath}`, ["Pass --force to overwrite."]);
  }

  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, buffer);

  // Dimensions + size reporting
  const info = await getImageInfoFromBuffer(buffer);
  const bytes = buffer.length;

  const result = {
    path: outPath,
    mime,
    bytes,
    width: info.width,
    height: info.height,
  };

  if (opts.json) {
    renderJson({
      ok: true,
      info: result,
    });
  } else {
    renderPlain(`Path: ${result.path}`);
    renderPlain(`MIME: ${result.mime}`);
    renderPlain(`Bytes: ${result.bytes}`);
    renderPlain(`Width: ${result.width}`);
    renderPlain(`Height: ${result.height}`);
  }
}
