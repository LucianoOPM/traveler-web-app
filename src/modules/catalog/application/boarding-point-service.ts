import { BusinessRuleError, NotFoundError } from "../../../lib/errors";
import type { BoardingPointRepository } from "../domain/boarding-point-repository";
import type { BoardingPoint } from "../types";

const nombreValido = (name: string) => {
  const limpio = name.trim();
  if (limpio === "") throw new BusinessRuleError("El nombre del punto de abordaje es obligatorio");
  return limpio;
};

const noEncontrado = () => new NotFoundError("Punto de abordaje no encontrado");

export class BoardingPointService {
  constructor(private readonly repo: BoardingPointRepository) {}

  list() {
    return this.repo.list();
  }

  async create(name: string): Promise<BoardingPoint> {
    return this.repo.create(nombreValido(name));
  }

  async edit(id: string, name: string): Promise<BoardingPoint> {
    const punto = await this.repo.update(id, nombreValido(name));
    if (!punto) throw noEncontrado();
    return punto;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repo.delete(id))) throw noEncontrado();
  }
}
