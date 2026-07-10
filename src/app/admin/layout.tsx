import type { ReactNode } from "react";

import AdminNav from "./AdminNav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100svh] bg-gradient-to-b from-slate-50 to-white">
      <AdminNav />
      {children}
    </div>
  );
}

