import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { assertAdminServer } from "@/lib/auth/role";

export default async function AdminUsersLayout({ children }: { children: ReactNode }) {
  const result = await assertAdminServer();
  if (!result.ok) redirect("/admin/login?next=/admin/users");
  return children;
}

