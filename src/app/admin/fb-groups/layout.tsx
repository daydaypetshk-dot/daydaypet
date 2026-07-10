import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { assertAdminServer } from "@/lib/auth/role";

export default async function AdminFbGroupsLayout({ children }: { children: ReactNode }) {
  const result = await assertAdminServer();
  if (!result.ok) redirect("/admin/login?next=/admin/fb-groups");
  return children;
}
