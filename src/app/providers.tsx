"use client";

import type { ReactNode } from "react";

import { SiteLogoProvider } from "@/lib/site-logo/client";

export default function AppProviders({ children }: { children: ReactNode }) {
  return <SiteLogoProvider>{children}</SiteLogoProvider>;
}
