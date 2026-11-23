import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type * as schema from "../../db/schema";
import { MediaService } from "./application/media-service";
import { AlmacenEnDisco } from "./infrastructure/almacen-en-disco";
import { DrizzleMediaRepository } from "./infrastructure/drizzle-media-repository";

/** Único sitio que conoce las clases concretas. El directorio sale del entorno del servidor. */
export function crearMedia(
  db: BunSQLDatabase<typeof schema>,
  directorio = process.env.PRIVATE_STORAGE_DIR!,
) {
  return new MediaService(new DrizzleMediaRepository(db), new AlmacenEnDisco(directorio));
}
