export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse, type NextRequest } from "next/server";

import { assertAdminServer } from "@/lib/auth/role";

const execFileAsync = promisify(execFile);
const REPORT_PATH = path.join(process.cwd(), "tmp-vet-scrape-report.json");
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "vet_scraper.ts");
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

type RunVetScraperBody = {
  district?: string;
  keyword?: string;
  limit?: number;
};

type VetScrapeReport = {
  district: string;
  keyword: string;
  query: string;
  mode?: string;
  queriesTried?: string[];
  queryAttempts?: Array<{ query: string; candidates: number }>;
  candidates: number;
  validPlaces: number;
  imported: number;
  failures: Array<Record<string, unknown>>;
  languageWarnings: Array<Record<string, unknown>>;
  importedRows: Array<Record<string, unknown>>;
};

let activeVetScraperRun: Promise<VetScrapeReport> | null = null;

function sanitizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLimit(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(num)));
}

async function readReportFile() {
  const raw = await fs.readFile(REPORT_PATH, "utf8");
  return JSON.parse(raw) as VetScrapeReport;
}

async function executeVetScraper(input: { district: string; keyword: string; limit: number }) {
  await fs.rm(REPORT_PATH, { force: true }).catch(() => null);

  const args = [
    "--experimental-strip-types",
    SCRIPT_PATH,
    "--district",
    input.district,
    "--keyword",
    input.keyword,
    "--limit",
    String(input.limit),
  ];

  try {
    await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n").trim();
    throw new Error(detail || "vet_scraper.ts 執行失敗");
  }

  return readReportFile();
}

export async function POST(req: NextRequest) {
  const guard = await assertAdminServer();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: RunVetScraperBody;
  try {
    body = (await req.json()) as RunVetScraperBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const district = sanitizeText(body.district);
  const keyword = sanitizeText(body.keyword);
  const limit = normalizeLimit(body.limit);

  if (!district) return NextResponse.json({ error: "Missing district" }, { status: 400 });
  if (!keyword) return NextResponse.json({ error: "Missing keyword" }, { status: 400 });

  if (activeVetScraperRun) {
    return NextResponse.json({ error: "目前已有爬蟲任務執行中，請稍候完成後再試。" }, { status: 409 });
  }

  activeVetScraperRun = executeVetScraper({ district, keyword, limit });

  try {
    const report = await activeVetScraperRun;
    return NextResponse.json({
      ok: true,
      imported: report.imported ?? 0,
      validPlaces: report.validPlaces ?? 0,
      candidates: report.candidates ?? 0,
      district: report.district,
      keyword: report.keyword,
      query: report.query,
      mode: report.mode ?? "vet",
      queryAttempts: Array.isArray(report.queryAttempts) ? report.queryAttempts : [],
      failures: Array.isArray(report.failures) ? report.failures : [],
      languageWarnings: Array.isArray(report.languageWarnings) ? report.languageWarnings : [],
      importedRows: Array.isArray(report.importedRows) ? report.importedRows : [],
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "執行獸醫爬蟲失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    activeVetScraperRun = null;
  }
}
