export type PetCase = {
  id: string;
  petName: string;
  location: string;
  lostTime: string;
  features: string;
  phone: string;
  imageUrl: string;
  sourceUrl: string;
  lat: number;
  lng: number;
  createdAt: string;
  sourceLabel?: string;
  kind?: "lost" | "sighting";
};

export type PetCaseInput = Omit<PetCase, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

