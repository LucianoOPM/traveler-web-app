import type { BoardingPoint } from "../types";

// `create` y `update` lanzan `ConflictError` si el nombre ya existe; `delete`, si el punto está
// asignado a una salida. `update` y `delete` devuelven `null`/`false` si el punto no existe.
export interface BoardingPointRepository {
  create(name: string): Promise<BoardingPoint>;
  update(id: string, name: string): Promise<BoardingPoint | null>;
  delete(id: string): Promise<boolean>;
}
