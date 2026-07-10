import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PetCase, PetCaseInput } from "./types";

function dataFilePath() {
  return path.join(process.cwd(), "data", "pets.json");
}

async function readAll(): Promise<PetCase[]> {
  const file = dataFilePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as PetCase[];
  } catch {
    return [];
  }
}

async function writeAll(items: PetCase[]) {
  const file = dataFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function stableId(input: PetCaseInput) {
  if (input.id) return input.id;
  const basis = input.sourceUrl || `${input.petName}|${input.location}|${input.lostTime}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 24);
}

export async function listPetCases(): Promise<PetCase[]> {
  const items = await readAll();
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function upsertPetCases(inputs: PetCaseInput[]) {
  const existing = await readAll();
  const byId = new Map(existing.map((p) => [p.id, p] as const));
  const now = new Date().toISOString();

  for (const input of inputs) {
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) continue;
    const id = stableId(input);
    const prev = byId.get(id);
    const next: PetCase = {
      id,
      createdAt: prev?.createdAt ?? input.createdAt ?? now,
      petName: input.petName ?? prev?.petName ?? "（未命名）",
      location: input.location ?? prev?.location ?? "",
      lostTime: input.lostTime ?? prev?.lostTime ?? "",
      features: input.features ?? prev?.features ?? "",
      phone: input.phone ?? prev?.phone ?? "",
      imageUrl: input.imageUrl ?? prev?.imageUrl ?? "",
      sourceUrl: input.sourceUrl ?? prev?.sourceUrl ?? "",
      lat: input.lat,
      lng: input.lng,
      sourceLabel: input.sourceLabel ?? prev?.sourceLabel,
      kind: input.kind ?? prev?.kind,
    };
    byId.set(id, next);
  }

  await writeAll(Array.from(byId.values()));
}

