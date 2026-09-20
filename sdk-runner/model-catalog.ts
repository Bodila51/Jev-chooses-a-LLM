/**
 * Discover models via Cursor.models.list() — NEVER invent IDs.
 * Prefer auto-smart + optimize_for; else pick three real catalog models for tiers.
 */
import type { RouteTier, RouterConfig, ModelSelection } from "../shared/types.js";

export interface CatalogModel {
  id: string;
  displayName?: string;
  parameters?: Array<{
    id: string;
    values: Array<{ value: string; displayName?: string }>;
  }>;
}

export interface CatalogClient {
  listModels(): Promise<CatalogModel[]>;
}

/** Lazy import @cursor/sdk so tests/CI work without it / without Node 22. */
export async function createCursorCatalogClient(apiKey?: string): Promise<CatalogClient | null> {
  const key = apiKey ?? process.env.CURSOR_API_KEY;
  if (!key) return null;
  try {
    const mod = await import("@cursor/sdk");
    const Cursor = (mod as { Cursor?: { models: { list: (o?: { apiKey?: string }) => Promise<CatalogModel[]> } } }).Cursor;
    if (!Cursor?.models?.list) return null;
    return {
      async listModels() {
        return Cursor.models.list({ apiKey: key });
      },
    };
  } catch {
    return null;
  }
}

export function pickTierModels(catalog: CatalogModel[], config: RouterConfig): Record<RouteTier, ModelSelection> {
  const autoSmart = catalog.find((m) => m.id === "auto-smart");
  const optimizeFor = autoSmart?.parameters?.find((p) => p.id === "optimize_for");
  const allowed = new Set((optimizeFor?.values ?? []).map((v) => v.value));

  if (autoSmart && optimizeFor) {
    const mk = (tier: RouteTier): ModelSelection => {
      const value = allowed.has(tier) ? tier : allowed.has("balanced") ? "balanced" : [...allowed][0];
      if (!value) {
        return staticFallback(tier, config);
      }
      return {
        id: autoSmart.id,
        params: [{ id: "optimize_for", value }],
        source: "auto-smart",
        displayName: `auto-smart/${value}`,
      };
    };
    return { cost: mk("cost"), balanced: mk("balanced"), intelligence: mk("intelligence") };
  }

  // No router: pick three distinct real IDs from catalog when possible
  const ids = catalog.map((m) => m.id).filter((id) => id !== "auto" && id !== "default");
  const pick = (preferred: string[], fallbackIdx: number): ModelSelection => {
    for (const p of preferred) {
      const hit = ids.find((id) => id === p || id.includes(p));
      if (hit) {
        return { id: hit, source: "catalog-fallback", displayName: hit };
      }
    }
    const id = ids[Math.min(fallbackIdx, Math.max(0, ids.length - 1))];
    if (id) return { id, source: "catalog-fallback", displayName: id };
    return staticFallback(
      fallbackIdx === 0 ? "cost" : fallbackIdx === 1 ? "balanced" : "intelligence",
      config,
    );
  };

  return {
    cost: pick(["composer-2.5", "composer-2", "composer"], 0),
    balanced: pick(["claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet", "gpt-5.4"], 1),
    intelligence: pick(["claude-opus-5", "claude-opus-4-8", "claude-opus", "gpt-5.6"], Math.min(2, ids.length - 1)),
  };
}

function staticFallback(tier: RouteTier, config: RouterConfig): ModelSelection {
  return {
    id: config.fallbackModels[tier],
    source: "static-fallback",
    displayName: `static:${config.fallbackModels[tier]}`,
  };
}

export async function resolveModelForTier(
  tier: RouteTier,
  config: RouterConfig,
  catalogClient?: CatalogClient | null,
): Promise<{ model: ModelSelection; catalogAvailable: boolean; catalog?: CatalogModel[] }> {
  if (!catalogClient) {
    return { model: staticFallback(tier, config), catalogAvailable: false };
  }
  try {
    const catalog = await catalogClient.listModels();
    const map = pickTierModels(catalog, config);
    return { model: map[tier], catalogAvailable: true, catalog };
  } catch {
    return { model: staticFallback(tier, config), catalogAvailable: false };
  }
}
