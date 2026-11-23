import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { baseDelServidor } from "@db/servidor";
import { exigirAdmin } from "@lib/guards";
import { crearCatalogo } from "@modules/catalog/container";
import { conErrores } from "./con-errores";

// Las Actions son públicas: cada handler llama a `exigirAdmin` antes de tocar nada. Las reglas de
// negocio viven en el servicio y el dominio; aquí solo se valida la forma (ADR-024, ADR-025).
const paquetes = async () => crearCatalogo(await baseDelServidor()).packages;

const salidas = async () => crearCatalogo(await baseDelServidor()).departures;
const puntos = async () => crearCatalogo(await baseDelServidor()).boardingPoints;

const id = z.strictObject({ id: z.uuid() });

// Solo la forma: enteros (centavos, nunca floats) que caben en `integer` de PostgreSQL y fechas UTC.
// El signo y `endsAt > startsAt` los comprueba el servicio (422) y los CHECK de la base.
const entero = z.int().max(2_147_483_647);
const fecha = z.iso.datetime().transform((texto) => new Date(texto));
const contenidoSalida = {
  startsAt: fecha,
  endsAt: fecha,
  capacity: entero,
  adultPriceCents: entero,
  childPriceCents: entero,
  infantPriceCents: entero,
};
const salidaYPunto = z.strictObject({ departureId: z.uuid(), boardingPointId: z.uuid() });

export const catalog = {
  createPackage: defineAction({
    input: z.strictObject({
      name: z.string().trim().min(1, "El nombre es obligatorio"),
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
  uploadCover: defineAction({
    accept: "form",
    input: z.object({ id: z.uuid(), file: z.instanceof(File) }),
    handler: conErrores("catalog.uploadCover", async ({ id, file }, { locals }) => {
      exigirAdmin(locals);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return (await paquetes()).setCover(id, bytes);
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

  createDeparture: defineAction({
    input: z.strictObject({ packageId: z.uuid(), ...contenidoSalida }),
    handler: conErrores("catalog.createDeparture", async (input, { locals }) => {
      exigirAdmin(locals);
      return (await salidas()).create(input);
    }),
  }),
  editDeparture: defineAction({
    input: z.strictObject({
      id: z.uuid(),
      startsAt: fecha.optional(),
      endsAt: fecha.optional(),
      capacity: entero.optional(),
      adultPriceCents: entero.optional(),
      childPriceCents: entero.optional(),
      infantPriceCents: entero.optional(),
    }),
    handler: conErrores("catalog.editDeparture", async ({ id, ...cambios }, { locals }) => {
      exigirAdmin(locals);
      return (await salidas()).edit(id, cambios);
    }),
  }),
  publishDeparture: defineAction({
    input: id,
    handler: conErrores("catalog.publishDeparture", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      return (await salidas()).publish(id);
    }),
  }),
  cancelDeparture: defineAction({
    input: id,
    handler: conErrores("catalog.cancelDeparture", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      return (await salidas()).cancel(id);
    }),
  }),
  deleteDeparture: defineAction({
    input: id,
    handler: conErrores("catalog.deleteDeparture", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      await (await salidas()).delete(id);
      return { id };
    }),
  }),
  assignBoardingPoint: defineAction({
    input: salidaYPunto,
    handler: conErrores("catalog.assignBoardingPoint", async (input, { locals }) => {
      exigirAdmin(locals);
      await (await salidas()).assignBoardingPoint(input.departureId, input.boardingPointId);
      return input;
    }),
  }),
  removeBoardingPoint: defineAction({
    input: salidaYPunto,
    handler: conErrores("catalog.removeBoardingPoint", async (input, { locals }) => {
      exigirAdmin(locals);
      await (await salidas()).removeBoardingPoint(input.departureId, input.boardingPointId);
      return input;
    }),
  }),

  createBoardingPoint: defineAction({
    input: z.strictObject({ name: z.string().trim() }),
    handler: conErrores("catalog.createBoardingPoint", async ({ name }, { locals }) => {
      exigirAdmin(locals);
      return (await puntos()).create(name);
    }),
  }),
  editBoardingPoint: defineAction({
    input: z.strictObject({ id: z.uuid(), name: z.string().trim() }),
    handler: conErrores("catalog.editBoardingPoint", async ({ id, name }, { locals }) => {
      exigirAdmin(locals);
      return (await puntos()).edit(id, name);
    }),
  }),
  deleteBoardingPoint: defineAction({
    input: id,
    handler: conErrores("catalog.deleteBoardingPoint", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      await (await puntos()).delete(id);
      return { id };
    }),
  }),
};
