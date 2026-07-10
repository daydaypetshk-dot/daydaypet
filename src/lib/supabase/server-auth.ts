import type { User } from "@supabase/supabase-js";

import { withTimeout } from "@/lib/server/promise-timeout";

const SUPABASE_AUTH_TIMEOUT_MS = 8_000;

type SupabaseAuthLike = {
  auth: {
    getUser: () => Promise<{
      data: { user: User | null };
      error: { message: string } | null;
    }>;
  };
};

export async function getSupabaseUserSafely(client: SupabaseAuthLike, context: string) {
  try {
    const { data, error } = await withTimeout(
      client.auth.getUser(),
      SUPABASE_AUTH_TIMEOUT_MS,
      `${context} auth.getUser`,
    );

    if (error) {
      return { user: null, reason: error.message };
    }

    if (!data.user) {
      return { user: null, reason: "Unauthorized" };
    }

    return { user: data.user, reason: null };
  } catch (error) {
    return {
      user: null,
      reason: error instanceof Error ? error.message : `${context} auth failed`,
    };
  }
}
