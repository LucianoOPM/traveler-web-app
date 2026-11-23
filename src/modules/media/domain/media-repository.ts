import type { MediaAsset, NewMediaAsset } from "../types";

export interface MediaRepository {
  find(id: string): Promise<MediaAsset | null>;
  create(datos: NewMediaAsset): Promise<MediaAsset>;
  delete(id: string): Promise<void>;
}
