import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { baseDelServidor } from "../db/servidor";
import { exigirAdmin } from "../lib/guards";
import { crearCatalogo } from "../modules/catalog/container";
import { conErrores } from "./con-errores";

// Las Actions son públicas: cada handler llama a `exigirAdmin` antes de tocar nada. Las reglas de
// negocio viven en el servicio y el dominio; aquí solo se valida la forma (ADR-024, ADR-025).
const paquetes = async () => crearCatalogo(await baseDelServidor()).packages;

const id = z.strictObject({ id: z.uuid() });

export const catalog = {
  createPackage: defineAction({
    input: z.strictObject({
      name: z.string().trim().min(1),
      summary: z.string().trim().optional(),
      description: z.string().trim().optional(),
    }),
    handler: conErrores("catalog.createPackage", async (input, { locals }) => {
      exigirAdmin(locals);
      return (await paquetes()).create(input);
    }),
  }),
  editPackage: defineAction({
    input: z.strictObject({
      id: z.uuid(),
      name: z.string().trim().optional(),
      summary: z.string().trim().optional(),
      description: z.string().trim().optional(),
    }),
    handler: conErrores("catalog.editPackage", async ({ id, ...cambios }, { locals }) => {
      exigirAdmin(locals);
      return (await paquetes()).edit(id, cambios);
    }),
  }),
  publishPackage: defineAction({
    input: id,
    handler: conErrores("catalog.publishPackage", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      return (await paquetes()).publish(id);
    }),
  }),
  archivePackage: defineAction({
    input: id,
    handler: conErrores("catalog.archivePackage", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      return (await paquetes()).archive(id);
    }),
  }),
  deletePackage: defineAction({
    input: id,
    handler: conErrores("catalog.deletePackage", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      await (await paquetes()).delete(id);
      return { id };
    }),
  }),
};
