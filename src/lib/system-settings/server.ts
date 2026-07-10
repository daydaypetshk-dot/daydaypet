import { supabaseAdmin } from "@/lib/supabase/admin";

export const SYSTEM_SETTING_KEYS = [
  "admin_whatsapp_number",
  "template_admin_notification",
  "template_citizen_approved",
] as const;

export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number];

export type SystemSettingRecord = {
  key: SystemSettingKey;
  value: string;
  description: string;
};

export const DEFAULT_SYSTEM_SETTINGS: Record<SystemSettingKey, SystemSettingRecord> = {
  admin_whatsapp_number: {
    key: "admin_whatsapp_number",
    value: "你的管理員預設電話",
    description: "接收新報料通知的管理員 WhatsApp 號碼",
  },
  template_admin_notification: {
    key: "template_admin_notification",
    value:
      "【日日寵】有新報料喇！毛孩：${pet_name}，特徵：${description}。請即入後台審批：${admin_url}",
    description: "發送給管理員的審批提醒範本",
  },
  template_citizen_approved: {
    key: "template_citizen_approved",
    value:
      "【日日寵】好消息！您提交的報料（${pet_name}）已通過審核並正式上架！感謝您的熱心幫忙。查看連結：${pet_url}",
    description: "案件成功上架後發送給市民的通知範本",
  },
};

function normalizeValue(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export async function getSystemSettings() {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("system_settings")
    .select("key,value,description")
    .in("key", [...SYSTEM_SETTING_KEYS]);

  if (error) {
    throw new Error(error.message);
  }

  const merged: Record<SystemSettingKey, SystemSettingRecord> = {
    admin_whatsapp_number: { ...DEFAULT_SYSTEM_SETTINGS.admin_whatsapp_number },
    template_admin_notification: { ...DEFAULT_SYSTEM_SETTINGS.template_admin_notification },
    template_citizen_approved: { ...DEFAULT_SYSTEM_SETTINGS.template_citizen_approved },
  };

  for (const row of data ?? []) {
    const key = row.key as SystemSettingKey;
    if (!(key in merged)) continue;
    merged[key] = {
      key,
      value: normalizeValue(row.value, merged[key].value),
      description: normalizeValue(row.description, merged[key].description),
    };
  }

  return merged;
}

export async function upsertSystemSettings(
  input: Partial<Record<SystemSettingKey, string>>,
) {
  const admin = supabaseAdmin();
  const current = await getSystemSettings();
  const rows = Object.entries(input)
    .filter(([key]) => SYSTEM_SETTING_KEYS.includes(key as SystemSettingKey))
    .map(([key, value]) => {
      const typedKey = key as SystemSettingKey;
      return {
        key: typedKey,
        value: normalizeValue(value, current[typedKey].value),
        description: current[typedKey].description,
      };
    });

  if (!rows.length) {
    return current;
  }

  const { error } = await admin.from("system_settings").upsert(rows, { onConflict: "key" });
  if (error) {
    throw new Error(error.message);
  }

  return getSystemSettings();
}

export function renderSystemTemplate(
  template: string,
  variables: Record<string, string | null | undefined>,
) {
  return template.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
    const value = variables[name];
    return value == null ? "" : String(value);
  });
}
