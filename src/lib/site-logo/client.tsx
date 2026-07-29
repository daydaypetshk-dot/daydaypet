"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const SITE_LOGO_CACHE_KEY = "daydaypet_site_logo_cache_v1";
const FALLBACK_LOGO_URL = "/logo.png";

type SiteLogoContextValue = {
  logoUrl: string;
  effectiveLogoUrl: string;
  isLoading: boolean;
  refreshLogo: () => Promise<void>;
  setLogoUrlOptimistic: (nextUrl: string) => void;
};

const SiteLogoContext = createContext<SiteLogoContextValue | null>(null);

function readCachedLogo(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(SITE_LOGO_CACHE_KEY);
    return raw ? String(raw || "").trim() : "";
  } catch {
    return "";
  }
}

function writeCachedLogo(url: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SITE_LOGO_CACHE_KEY, url);
  } catch {
    /* ignore */
  }
}

export function SiteLogoProvider({ children }: { children: ReactNode }) {
  const [cachedUrl, setCachedUrl] = useState<string>(() => readCachedLogo());
  const [remoteUrl, setRemoteUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [nonce, setNonce] = useState<number>(0);

  const effectiveLogoUrl = useMemo(() => {
    const primary = remoteUrl.trim() || cachedUrl.trim();
    return primary || FALLBACK_LOGO_URL;
  }, [remoteUrl, cachedUrl]);

  const logoUrl = useMemo(() => remoteUrl.trim() || cachedUrl.trim(), [remoteUrl, cachedUrl]);

  const refreshLogo = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/site-logo", { method: "GET", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch site logo");
      const data = (await res.json()) as {
        logoUrl?: string;
        effectiveLogoUrl?: string;
        fallbackLogoUrl?: string;
      };
      const next = String(data.logoUrl ?? "").trim();
      setRemoteUrl(next);
      setCachedUrl(next);
      writeCachedLogo(next);
      console.log("[SiteLogoProvider] Fetched logo URL:", next || "(using fallback)");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error || "");
      console.warn("[SiteLogoProvider] Failed to refresh site logo:", msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setLogoUrlOptimistic = useCallback((nextUrl: string) => {
    const normalized = String(nextUrl ?? "").trim();
    setRemoteUrl(normalized);
    setCachedUrl(normalized);
    writeCachedLogo(normalized);
  }, []);

  useEffect(() => {
    void refreshLogo();
  }, [nonce, refreshLogo]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __daydaypetLogoUpdate?: (u: string) => void }).__daydaypetLogoUpdate =
      (nextUrl: string) => {
        const normalized = String(nextUrl ?? "").trim();
        setRemoteUrl(normalized);
        setCachedUrl(normalized);
        writeCachedLogo(normalized);
      };
    return () => {
      try {
        delete (window as unknown as { __daydaypetLogoUpdate?: unknown }).__daydaypetLogoUpdate;
      } catch {
        /* ignore */
      }
    };
  }, []);

  const value = useMemo<SiteLogoContextValue>(
    () => ({
      logoUrl,
      effectiveLogoUrl,
      isLoading,
      refreshLogo: async () => {
        setNonce((n) => n + 1);
      },
      setLogoUrlOptimistic,
    }),
    [logoUrl, effectiveLogoUrl, isLoading, setLogoUrlOptimistic],
  );

  return <SiteLogoContext.Provider value={value}>{children}</SiteLogoContext.Provider>;
}

export function useSiteLogo(): SiteLogoContextValue {
  const ctx = useContext(SiteLogoContext);
  if (ctx) return ctx;
  const fallbackUrl = typeof window !== "undefined" ? readCachedLogo() : "";
  return {
    logoUrl: fallbackUrl,
    effectiveLogoUrl: fallbackUrl || FALLBACK_LOGO_URL,
    isLoading: false,
    refreshLogo: async () => {},
    setLogoUrlOptimistic: () => {},
  };
}
