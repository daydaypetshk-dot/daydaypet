type FbPostRow = {
  id: string;
  fb_post_id: string;
  post_url: string;
  content_text: string | null;
  raw_payload: unknown;
};

type PetType = "cat" | "dog" | "bird" | "other";

type MockAiResult = {
  engine: "mock_ai_v1";
  is_pet_post: boolean;
  verdict: "relevant" | "ignored";
  pet_type: PetType | null;
  breed: string | null;
  location: string | null;
  characteristics: string | null;
  contact_phone: string | null;
  confidence: number;
  matched_keywords: string[];
  notes: string | null;
};

const normalizeText = (input: unknown) =>
  String(input ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const sumMatches = (text: string, rx: RegExp) => {
  const m = text.match(rx);
  return m ? m.length : 0;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const HK_DISTRICTS = [
  "中西區",
  "灣仔區",
  "東區",
  "南區",
  "油尖旺區",
  "深水埗區",
  "九龍城區",
  "黃大仙區",
  "觀塘區",
  "葵青區",
  "荃灣區",
  "屯門區",
  "元朗區",
  "北區",
  "大埔區",
  "沙田區",
  "西貢區",
  "離島區",
];

const HK_PLACES = [
  ...HK_DISTRICTS,
  "屯門",
  "元朗",
  "沙田",
  "大埔",
  "上水",
  "粉嶺",
  "將軍澳",
  "西貢",
  "荃灣",
  "葵涌",
  "青衣",
  "旺角",
  "太子",
  "油麻地",
  "佐敦",
  "尖沙咀",
  "九龍灣",
  "觀塘",
  "黃大仙",
  "深水埗",
  "長沙灣",
  "土瓜灣",
  "紅磡",
  "九龍城",
  "銅鑼灣",
  "北角",
  "西灣河",
  "柴灣",
  "筲箕灣",
  "中環",
  "上環",
  "金鐘",
  "灣仔",
  "堅尼地城",
  "薄扶林",
  "香港仔",
  "鴨脷洲",
  "赤柱",
  "東涌",
  "大嶼山",
  "長洲",
];

const extractPhone = (text: string) => {
  const t = text.replace(/[()\s-]/g, "");
  const m = t.match(/(?:\+?852)?([2-9]\d{7})/);
  return m?.[1] ? m[1] : null;
};

const extractLocation = (text: string) => {
  const marker = text.match(/(?:地點|位置|附近|喺|係|於|在)[:：]?\s*([^\n，。,．]{2,18})/i);
  if (marker?.[1]) return marker[1].trim();
  const hit = HK_PLACES.find((name) => text.includes(name));
  return hit || null;
};

const extractBreed = (text: string) => {
  const m = text.match(/(?:品種|breed)[:：]?\s*([^\n，。,．]{2,40})/i);
  return m?.[1] ? m[1].trim() : null;
};

const extractCharacteristics = (text: string) => {
  const m = text.match(/(?:特徵|特點|顏色|花紋|頸圈|胸背)[:：]?\s*([^\n]{2,140})/i);
  return m?.[1] ? m[1].trim() : null;
};

function mockAiExtract(row: FbPostRow): MockAiResult {
  const text = normalizeText(row.content_text || "");
  const matched: string[] = [];

  const rxCat = /貓|貓咪|喵|英短|美短|豹貓|唐貓/gi;
  const rxDog = /狗|狗狗|柴犬|貴婦|貴賓|哥基|柯基|松鼠狗/gi;
  const rxBird =
    /鳥|雀|鸚鵡|parrot|玄鳳|雞尾|雞尾鸚鵡|虎皮|和尚|和尚鸚鵡|小太陽|錐尾|牡丹|灰鸚|非洲灰鸚/gi;
  const rxOtherPet = /兔|倉鼠|龜|爬蟲|龍貓/gi;

  const rxLost = /不見|走失|遺失|失蹤|求助|尋|寻|missing|lost|幫手搵|幫手找/gi;
  const rxSighting = /目擊|見到|見過|發現|出沒|徘徊/gi;
  const rxContact = /聯絡|電話|whatsapp|wtsapp|inbox|pm|私訊|dm/gi;

  const catCount = sumMatches(text, rxCat);
  const dogCount = sumMatches(text, rxDog);
  const birdCount = sumMatches(text, rxBird);
  const otherCount = sumMatches(text, rxOtherPet);

  const lostCount = sumMatches(text, rxLost);
  const sightCount = sumMatches(text, rxSighting);
  const contactCount = sumMatches(text, rxContact);

  const phone = extractPhone(text);
  if (phone) matched.push("contact_phone");

  const location = extractLocation(text);
  if (location) matched.push("location");

  const scores: Array<{ type: PetType; score: number; kw: string }> = [
    { type: "cat", score: catCount, kw: "cat" },
    { type: "dog", score: dogCount, kw: "dog" },
    { type: "bird", score: birdCount, kw: "bird" },
    { type: "other", score: otherCount, kw: "other" },
  ];

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const petType: PetType | null = best.score > 0 ? best.type : null;
  if (petType) matched.push(`pet_type:${petType}`);

  let score = 0;
  if (petType === "cat" || petType === "dog" || petType === "bird") score += 2;
  if (petType === "other") score += 1;
  if (lostCount > 0) {
    score += 2;
    matched.push("lost_keywords");
  }
  if (sightCount > 0) {
    score += 1;
    matched.push("sighting_keywords");
  }
  if (contactCount > 0) {
    score += 1;
    matched.push("contact_keywords");
  }
  if (phone) score += 2;

  const hasPetKeyword = Boolean(petType);
  const hasLocation = Boolean(location);
  const isPetPost = score >= 3 || (hasPetKeyword && hasLocation);
  const verdict: "relevant" | "ignored" = isPetPost ? "relevant" : "ignored";

  if (!score && hasPetKeyword && hasLocation) {
    matched.push("pet_location_combo");
  }

  const breed = extractBreed(text);
  if (breed) matched.push("breed");

  const characteristics = extractCharacteristics(text);
  if (characteristics) matched.push("characteristics");

  const confidence = score >= 3 ? clamp01(score / 8) : hasPetKeyword && hasLocation ? 0.55 : clamp01(score / 8);
  const notes = text ? text.slice(0, 160) : null;

  return {
    engine: "mock_ai_v1",
    is_pet_post: isPetPost,
    verdict,
    pet_type: isPetPost ? petType : null,
    breed: isPetPost ? breed : null,
    location: isPetPost ? location : null,
    characteristics: isPetPost ? characteristics : null,
    contact_phone: isPetPost ? phone : null,
    confidence,
    matched_keywords: matched,
    notes,
  };
}

export function clampFbAiLimit(n: unknown) {
  const raw = Number(n);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(Math.max(Math.floor(raw), 1), 20);
}

export async function processPendingFbPosts(
  admin: any,
  options?: {
    limit?: number;
    ids?: string[];
  },
) {
  const limit = clampFbAiLimit(options?.limit);
  const ids = Array.isArray(options?.ids) ? options!.ids.map(String).filter(Boolean) : [];

  let query = admin
    .from("fb_group_posts")
    .select("id,fb_post_id,post_url,content_text,raw_payload")
    .eq("ai_status", "pending")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (ids.length) query = query.in("id", ids);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const posts = (rows ?? []) as FbPostRow[];
  if (!posts.length) return { processed: 0, done: 0, skipped: 0, failed: 0 };

  const nowIso = new Date().toISOString();
  const postIds = posts.map((p) => p.id);
  await admin
    .from("fb_group_posts")
    .update({ ai_status: "processing" })
    .in("id", postIds)
    .eq("ai_status", "pending");

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of posts) {
    try {
      const aiResult = mockAiExtract(row);
      const nextStatus = aiResult.is_pet_post ? "done" : "skipped";

      const { error: updateError } = await admin
        .from("fb_group_posts")
        .update({
          ai_status: nextStatus,
          ai_result: aiResult,
          ai_error: null,
          ai_processed_at: nowIso,
        })
        .eq("id", row.id);

      if (updateError) throw new Error(updateError.message);
      if (aiResult.is_pet_post) done += 1;
      else skipped += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e || "ai_failed");
      await admin
        .from("fb_group_posts")
        .update({
          ai_status: "failed",
          ai_error: message,
          ai_processed_at: nowIso,
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return {
    processed: posts.length,
    done,
    skipped,
    failed,
  };
}
