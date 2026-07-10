import { supabaseAdmin } from "@/lib/supabase/admin";

export type CreateNotificationInput = {
  userId: string;
  petId?: string | null;
  title: string;
  content: string;
};

export async function createNotification(input: CreateNotificationInput) {
  const admin = supabaseAdmin();
  const { error } = await admin.from("notifications").insert({
    user_id: input.userId,
    pet_id: input.petId ?? null,
    title: input.title,
    content: input.content,
  });
  if (error) {
    throw new Error(error.message);
  }
}
