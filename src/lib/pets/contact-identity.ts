export type ContactIdentityType =
  | "owner"
  | "repost_owner"
  | "passerby"
  | "repost_sighting"
  | "rescued_finder"
  | "repost_rescued";
export type LegacySourceType = "self" | "social";
export type PetSourceType = ContactIdentityType | LegacySourceType;
export type CaseIdentityCategory = "seeking" | "sighting" | "rescued";

export const CONTACT_IDENTITY_OPTIONS: Array<{ value: ContactIdentityType; label: string }> = [
  { value: "owner", label: "🚨 主人親自發佈" },
  { value: "repost_owner", label: "🚨 社交媒體轉貼 (主人帖文)" },
  { value: "passerby", label: "👁️ 熱心路人目擊" },
  { value: "repost_sighting", label: "👁️ 社交媒體轉貼 (路人目擊)" },
  { value: "rescued_finder", label: "🏡 已救起搵主人" },
  { value: "repost_rescued", label: "🏡 轉貼的已救起搵主人" },
];

export function normalizeContactIdentity(
  raw: string | null | undefined,
  caseType?: string | null,
): ContactIdentityType {
  const value = String(raw || "").trim().toLowerCase();
  if (
    value === "owner" ||
    value === "rescued_finder" ||
    value === "passerby" ||
    value === "repost_owner" ||
    value === "repost_sighting" ||
    value === "repost_rescued"
  ) {
    return value;
  }
  if (value === "self") {
    if (caseType === "found_rescued") return "rescued_finder";
    return caseType === "lost" ? "owner" : "passerby";
  }
  if (value === "social") {
    if (caseType === "found_rescued") return "repost_rescued";
    return caseType === "lost" ? "repost_owner" : "repost_sighting";
  }
  if (caseType === "found_rescued") return "rescued_finder";
  return caseType === "lost" ? "owner" : "passerby";
}

export function getContactIdentityLabel(identity: ContactIdentityType) {
  return CONTACT_IDENTITY_OPTIONS.find((item) => item.value === identity)?.label || "🚨 主人親自發佈";
}

export function needsSourceLink(identity: ContactIdentityType) {
  return identity === "repost_owner" || identity === "repost_sighting" || identity === "repost_rescued";
}

export function getCaseIdentityCategory(identity: ContactIdentityType): CaseIdentityCategory {
  if (identity === "owner" || identity === "repost_owner") return "seeking";
  if (identity === "rescued_finder" || identity === "repost_rescued") return "rescued";
  return "sighting";
}

export function getCaseIdentityCategoryLabel(identity: ContactIdentityType) {
  const category = getCaseIdentityCategory(identity);
  if (category === "seeking") return "尋寵案件";
  if (category === "rescued") return "已救起案件";
  return "目擊案件";
}

export function getDefaultCaseTypeForIdentity(identity: ContactIdentityType) {
  const category = getCaseIdentityCategory(identity);
  if (category === "seeking") return "lost";
  if (category === "rescued") return "found_rescued";
  return "spotted_unrescued";
}

export function isRepostIdentity(identity: ContactIdentityType) {
  return identity === "repost_owner" || identity === "repost_sighting" || identity === "repost_rescued";
}

export function syncIdentityWithCaseType(
  identity: ContactIdentityType,
  caseType: "lost" | "spotted_unrescued" | "found_rescued",
): ContactIdentityType {
  const repost = isRepostIdentity(identity);
  if (caseType === "lost") return repost ? "repost_owner" : "owner";
  if (caseType === "found_rescued") return repost ? "repost_rescued" : "rescued_finder";
  return repost ? "repost_sighting" : "passerby";
}

export function getContactActionTarget(identity: ContactIdentityType) {
  if (identity === "owner") return "主人";
  if (identity === "passerby") return "目擊者";
  if (identity === "rescued_finder") return "救起人";
  return "轉貼人";
}
