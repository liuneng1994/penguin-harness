/** The CLI owns TRAE's catalog, including account-specific Standard and Max backends. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readTraeAuth, traeCliHome } from "./auth.js";

const execFileAsync = promisify(execFile);

interface CatalogRow {
  slug?: string;
  name?: string;
  config_name?: string;
  backend_model?: string;
  context_window?: number;
  business_metadata?: {
    variants?: {
      standard_key?: string;
      max_key?: string | null;
      standard_context_window?: number;
      max_context_window?: number;
    };
  };
}

export interface TraeModel {
  modelId: string;
  displayName: string;
  configName: string;
  backendModel: string;
  contextWindow?: number;
}

function entries(raw: unknown): CatalogRow[] {
  const rows = Array.isArray(raw) ? raw : (raw as { models?: unknown } | null)?.models;
  if (!Array.isArray(rows)) throw new Error("Invalid TRAE model catalog. Run `traecli models`.");
  return rows.filter((row): row is CatalogRow => row !== null && typeof row === "object");
}

function modelsFromRows(rows: CatalogRow[]): TraeModel[] {
  const models = new Map<string, TraeModel>();
  for (const row of rows) {
    const slug = row.slug ?? row.name;
    if (
      typeof slug !== "string" ||
      !slug.trim() ||
      slug.length > 190 ||
      /[\u0000-\u001f\u007f]/.test(slug)
    )
      continue;
    const configName = row.config_name ?? slug;
    const variants = row.business_metadata?.variants;
    const window = variants?.standard_context_window ?? row.context_window;
    const model: TraeModel = {
      modelId: slug,
      displayName: slug,
      configName,
      backendModel: variants?.standard_key ?? row.backend_model ?? `${configName}__dev`,
      ...(Number.isSafeInteger(window) && window! > 0 ? { contextWindow: window } : {}),
    };
    models.set(model.modelId, model);
    if (typeof variants?.max_key === "string" && variants.max_key) {
      const maxWindow = variants.max_context_window ?? window;
      models.set(`${slug}-max`, {
        ...model,
        modelId: `${slug}-max`,
        displayName: `${slug} Max`,
        backendModel: variants.max_key,
        ...(Number.isSafeInteger(maxWindow) && maxWindow! > 0 ? { contextWindow: maxWindow } : {}),
      });
    }
  }
  return [...models.values()];
}

let cached: { home: string; authUpdatedAt: string; at: number; models: TraeModel[] } | undefined;

export async function listTraeModels(refresh = false): Promise<TraeModel[]> {
  const auth = readTraeAuth();
  const home = traeCliHome();
  if (
    !refresh &&
    cached?.home === home &&
    cached.authUpdatedAt === auth.updatedAt &&
    Date.now() - cached.at < 300_000
  )
    return cached.models;
  let rows: CatalogRow[];
  try {
    const { stdout } = await execFileAsync(
      process.env.TRAECLI_BIN ?? "traecli",
      ["models", "--json"],
      {
        timeout: 15_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    rows = entries(JSON.parse(stdout));
    // CLI output can omit variant metadata; its own cache keeps the backend keys.
    try {
      const richer = entries(
        JSON.parse(await fs.readFile(path.join(home, "models_cache.json"), "utf8")),
      );
      const bySlug = new Map(richer.map((r) => [r.slug ?? r.name, r]));
      rows = rows.map((r) => ({ ...bySlug.get(r.slug ?? r.name), ...r }));
    } catch {
      // A successful CLI listing remains usable without a cache file.
    }
  } catch {
    try {
      rows = entries(JSON.parse(await fs.readFile(path.join(home, "models_cache.json"), "utf8")));
    } catch {
      throw new Error(
        "No TRAE model catalog. Install TRAE CLI and run `traecli models` on the server machine.",
      );
    }
  }
  const models = modelsFromRows(rows);
  if (models.length === 0)
    throw new Error("No TRAE models available. Run `traecli models` on the server machine.");
  cached = { home, authUpdatedAt: auth.updatedAt, at: Date.now(), models };
  return models;
}
