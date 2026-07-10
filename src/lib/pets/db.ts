import type { PetSourceType } from "@/lib/pets/contact-identity";

export type PetStatus = "approved" | "pending" | "resolved";

export type PetTimelineItem = {
  time: string;
  text: string;
  imageUrl?: string | null;
};

export type PetRow = {
  id: string;
  user_id: string | null;
  pet_name: string;
  pet_type: "cat" | "dog" | "bird" | "other";
  breed: string | null;
  location: string;
  manual_address: string | null;
  district: string | null;
  lost_time: string;
  features: string;
  phone: string;
  enable_privacy: boolean;
  image_url: string;
  source_url: string;
  source_type: PetSourceType;
  source_link: string | null;
  case_type: "lost" | "spotted_unrescued" | "found_rescued";
  status: PetStatus;
  latitude: number | null;
  longitude: number | null;
  timeline: PetTimelineItem[] | null;
  created_at: string;
};

export type PetInsert = Omit<PetRow, "id" | "created_at" | "timeline"> & {
  id?: string;
  created_at?: string;
  timeline?: PetTimelineItem[] | null;
};
