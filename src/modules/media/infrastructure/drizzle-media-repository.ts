import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../../db/schema";
import type { MediaRepository } from "../domain/media-repository";
import { mediaAssets } from "../schema";

export class DrizzleMediaRepository implements MediaRepository {
  constructor(private readonly db: BunSQLDatabase<typeof schema>) {}

  async find(id: string) {
    const [fila] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return fila ?? null;
  }

  async create(datos: Parameters<MediaRepository["create"]>[0]) {
    const [fila] = await this.db.insert(mediaAssets).values(datos).returning();
    return fila!;
  }

  async delete(id: string) {
    await this.db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  }
}
