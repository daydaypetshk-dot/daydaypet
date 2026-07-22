const FB_AI_STATUSES = ["pending", "processing", "done", "skipped", "failed"] as const;

export type FbAiStatus = (typeof FB_AI_STATUSES)[number];

export type FbAiStatusCounts = Record<FbAiStatus, number>;

async function countFbAiStatus(admin: any, status: FbAiStatus) {
  const { count, error } = await admin
    .from("fb_group_posts")
    .select("id", { count: "exact", head: true })
    .eq("ai_status", status);
  if (error) throw new Error(error.message);
  return typeof count === "number" ? count : 0;
}

export async function getFbAiStatusCounts(admin: any): Promise<FbAiStatusCounts> {
  const pairs = await Promise.all(FB_AI_STATUSES.map(async (status) => [status, await countFbAiStatus(admin, status)] as const));
  return Object.fromEntries(pairs) as FbAiStatusCounts;
}

export function formatFbAiStatusCounts(counts: FbAiStatusCounts) {
  return `狀態統計：pending ${counts.pending} / done ${counts.done} / skipped ${counts.skipped} / failed ${counts.failed}`;
}
