import type { MemoryCapability } from "./generated/adminV1";

export const CORE_MEMORY_CAPABILITIES: MemoryCapability[] = [
  "projects.status",
  "memories.list",
  "memories.get",
];

export function negotiateMemoryCapabilities(apiVersion: string, capabilities: readonly string[]): {
  compatible: boolean;
  available: Set<string>;
  missingCore: MemoryCapability[];
} {
  const available = new Set(capabilities);
  const missingCore = CORE_MEMORY_CAPABILITIES.filter((capability) => !available.has(capability));
  return { compatible: apiVersion.split(".")[0] === "1" && missingCore.length === 0, available, missingCore };
}
