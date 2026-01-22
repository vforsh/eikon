import { ENV } from "../env";
import { EikonError, ExitCode } from "../errors";
import { renderHuman, renderJson } from "../output";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type KeysResponse = {
  data: Array<{
    hash: string;
    name: string;
    label: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    include_byok_in_limit: boolean;
    usage: number;
    usage_daily: number;
    usage_weekly: number;
    usage_monthly: number;
    byok_usage: number;
    byok_usage_daily: number;
    byok_usage_weekly: number;
    byok_usage_monthly: number;
    created_at: string;
    updated_at: string | null;
    expires_at?: string | null;
  }>;
};

type GuardrailsResponse = {
  data: Array<{
    id: string;
    name: string;
    description?: string | null;
    limit_usd?: number | null;
    reset_interval?: string | null;
    allowed_providers?: string[] | null;
    allowed_models?: string[] | null;
    enforce_zdr?: boolean | null;
    created_at: string;
    updated_at?: string | null;
  }>;
  total_count: number;
};

type OpenRouterOptions = {
  apiKey?: string;
  json?: boolean;
};

export async function openrouterKeysCommand(opts: OpenRouterOptions) {
  const apiKey = resolveApiKey(opts);
  const response = await fetchOpenRouter<KeysResponse>("/keys", apiKey);

  if (opts.json) {
    renderJson(response);
    return;
  }

  const entries = Array.isArray(response?.data) ? response.data : [];
  if (entries.length === 0) {
    renderHuman("No keys found.");
    return;
  }

  const blocks = entries.map(formatKeyEntry);
  renderHuman(blocks.join("\n\n"));
}

export async function openrouterGuardrailsCommand(opts: OpenRouterOptions) {
  const apiKey = resolveApiKey(opts);
  const response = await fetchOpenRouter<GuardrailsResponse>("/guardrails", apiKey);

  if (opts.json) {
    renderJson(response);
    return;
  }

  const entries = Array.isArray(response?.data) ? response.data : [];
  if (entries.length === 0) {
    renderHuman("No guardrails found.");
    return;
  }

  const blocks = entries.map(formatGuardrailEntry);
  renderHuman(blocks.join("\n\n"));
}

function resolveApiKey(opts: OpenRouterOptions) {
  const apiKey = opts.apiKey?.trim();
  if (apiKey) return apiKey;

  const provisioningKey = ENV.OPENROUTER_PROVISIONING_KEY?.trim();
  if (provisioningKey) return provisioningKey;

  const legacyKey = ENV.OPENROUTER_API_KEY?.trim();
  if (legacyKey) return legacyKey;

  throw new EikonError(
    "Missing OpenRouter provisioning key.",
    ExitCode.ExternalError,
    ["Set OPENROUTER_PROVISIONING_KEY, set OPENROUTER_API_KEY, or pass --api-key."],
    "openrouter"
  );
}

async function fetchOpenRouter<T>(path: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = ENV.EIKON_TIMEOUT_MS ?? 30000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = await readResponseBody(response);
    const hints = body ? [`API response: ${body}`] : [];

    if (response.status === 401) {
      throw new EikonError(
        "OpenRouter auth failed. Provisioning key required.",
        ExitCode.ExternalError,
        hints,
        "openrouter"
      );
    }

    throw new EikonError(
      `OpenRouter API error: ${response.status} ${response.statusText}`.trim(),
      ExitCode.ExternalError,
      hints,
      "openrouter"
    );
  } catch (error: any) {
    if (error instanceof EikonError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new EikonError(
        "OpenRouter request timed out.",
        ExitCode.ExternalError,
        [],
        "openrouter"
      );
    }
    throw new EikonError(
      `OpenRouter request failed: ${error?.message || String(error)}`,
      ExitCode.ExternalError,
      [],
      "openrouter"
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return "";

  try {
    const json = JSON.parse(text);
    return JSON.stringify(json);
  } catch {
    return text.trim();
  }
}

function formatKeyEntry(entry: KeysResponse["data"][number]) {
  const lines = [
    `label: ${formatValue(entry.label)}`,
    `name: ${formatValue(entry.name)}`,
    `hash: ${formatValue(entry.hash)}`,
    `disabled: ${formatValue(entry.disabled)}`,
    `usage: ${formatMoney(entry.usage)}`,
    `usage_daily: ${formatMoney(entry.usage_daily)}`,
    `limit: ${formatMoney(entry.limit)}`,
    `limit_remaining: ${formatMoney(entry.limit_remaining)}`,
    `created_at: ${formatValue(entry.created_at)}`,
  ];

  return lines.join("\n");
}

function formatGuardrailEntry(entry: GuardrailsResponse["data"][number]) {
  const lines = [
    `name: ${formatValue(entry.name)}`,
    `id: ${formatValue(entry.id)}`,
    `limit_usd: ${formatValue(entry.limit_usd)}`,
    `reset_interval: ${formatValue(entry.reset_interval)}`,
    `enforce_zdr: ${formatValue(entry.enforce_zdr)}`,
    `allowed_models: ${formatList(entry.allowed_models)}`,
    `allowed_providers: ${formatList(entry.allowed_providers)}`,
    `created_at: ${formatValue(entry.created_at)}`,
  ];

  return lines.join("\n");
}

function formatList(values?: string[] | null) {
  if (!values || values.length === 0) return "none";
  return values.join(", ");
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "null";
  }
  return String(value);
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "null";
  if (!Number.isFinite(value)) return "null";
  return `$${value.toFixed(2)}`;
}
