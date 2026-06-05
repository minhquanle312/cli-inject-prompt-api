import { getModel, listModels, toAdapter } from "./models.js";
import type { AdapterConfig } from "./types.js";

export function getAdapter(model: string): AdapterConfig | undefined {
  const entry = getModel(model);
  return entry ? toAdapter(entry) : undefined;
}

export function listAdapters(): AdapterConfig[] {
  return listModels().map(toAdapter);
}
