import { DISTRICTS_HK, normalizeDistrict, type District } from "@/lib/pets/district";

export const ALL_DISTRICTS_TOKEN = "all" as const;

export type SubscriptionDistrict = District | typeof ALL_DISTRICTS_TOKEN;

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function normalizeSubscriptionDistricts(input: unknown): SubscriptionDistrict[] {
  const rawValues = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const normalized: SubscriptionDistrict[] = [];

  for (const raw of rawValues) {
    const value = String(raw || "").trim();
    if (!value) continue;
    if (value === ALL_DISTRICTS_TOKEN || value === "全港") {
      return [ALL_DISTRICTS_TOKEN];
    }
    const district = normalizeDistrict(value);
    if (district && district !== "全港") normalized.push(district);
  }

  return unique(normalized);
}

export function getSubscriptionDistrictLabels(selection: SubscriptionDistrict[]): string[] {
  if (selection.includes(ALL_DISTRICTS_TOKEN)) return ["全港"];
  return selection;
}

export function getSubscriptionDistrictSummary(selection: SubscriptionDistrict[]): string {
  const labels = getSubscriptionDistrictLabels(selection);
  if (labels.length === 0) return "未選地區";
  if (labels.length <= 2) return labels.join("、");
  return `${labels.slice(0, 2).join("、")}等共 ${labels.length} 個區域`;
}

export function matchesSubscriptionDistrict(
  eventDistrict: string | null | undefined,
  selection: SubscriptionDistrict[],
) {
  if (selection.includes(ALL_DISTRICTS_TOKEN)) return true;
  const normalized = normalizeDistrict(String(eventDistrict || "").trim());
  if (!normalized || normalized === "全港") return false;
  return selection.includes(normalized);
}

export function getRealtimeChannelNames(selection: SubscriptionDistrict[]) {
  if (selection.includes(ALL_DISTRICTS_TOKEN)) return ["district:all"];
  return selection.map((district) => `district:${district}`);
}

export function getDistrictCheckboxOptions(): District[] {
  return DISTRICTS_HK.filter((district) => district !== "全港") as District[];
}
