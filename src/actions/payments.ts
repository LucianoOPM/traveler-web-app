import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { baseDelServidor } from "@db/servidor";
import { TooManyRequestsError } from "@lib/errors";
import { exigirAdmin } from "@lib/guards";
import { LimiteDeSolicitudes } from "@modules/bookings/domain/rate-limit";
import { crearPagos } from "@modules/payments/container";
import { conErrores } from "./con-errores";

// Las Actions son públicas: cada handler llama a `exigirAdmin` antes de tocar nada. Aquí solo se
// valida la forma; la CLABE y el resto de reglas viven en el servicio (ADR-024, ADR-025, ADR-026).
// El actor de la auditoría sale siempre de la sesión del servidor, nunca de la entrada.
// Pedir instrucciones es público (solo el token del comprador). Límite propio por IP, independiente
// del de reservas; cuenta toda solicitud con forma válida.
const limiteInstrucciones = new LimiteDeSolicitudes(20, 60 * 60 * 1000);
const pagos = async () => crearPagos(await baseDelServidor());
const cuentas = async () => crearPagos(await baseDelServidor()).bankAccounts;

const id = z.strictObject({ id: z.uuid() });
// Enteros (centavos, nunca floats) que caben en `integer` de PostgreSQL.
const entero = z.int().max(2_147_483_647);
const datosCuenta = {
  name: z.string(),
  bankName: z.string(),
  accountHolder: z.string(),
  clabe: z.string(),
  priority: entero,
  monthlyLimitCents: entero,
};

export const payments = {
  requestInstructions: defineAction({
    // El token mide 43 caracteres; el tope evita procesar entradas enormes. El formato lo valida el servicio.
    input: z.strictObject({ token: z.string().max(200) }),
    handler: conErrores("payments.requestInstructions", async ({ token }, { clientAddress }) => {
      if (!limiteInstrucciones.intentar(clientAddress)) {
        throw new TooManyRequestsError("Demasiadas solicitudes; inténtalo de nuevo más tarde");
      }
      return (await pagos()).allocations.requestInstructions(token);
    }),
  }),
  createAccount: defineAction({
    input: z.strictObject(datosCuenta),
    handler: conErrores("payments.createAccount", async (input, { locals }) => {
      exigirAdmin(locals);
      return (await cuentas()).create(locals.user!.id, input);
    }),
  }),
  editAccount: defineAction({
    input: z.strictObject({ id: z.uuid(), ...datosCuenta }),
    handler: conErrores("payments.editAccount", async ({ id, ...datos }, { locals }) => {
      exigirAdmin(locals);
      return (await cuentas()).edit(locals.user!.id, id, datos);
    }),
  }),
  setAccountEligible: defineAction({
    input: z.strictObject({ id: z.uuid(), isEligible: z.boolean() }),
    handler: conErrores("payments.setAccountEligible", async ({ id, isEligible }, { locals }) => {
      exigirAdmin(locals);
      return (await cuentas()).setEligible(locals.user!.id, id, isEligible);
    }),
  }),
  deleteAccount: defineAction({
    input: id,
    handler: conErrores("payments.deleteAccount", async ({ id }, { locals }) => {
      exigirAdmin(locals);
      await (await cuentas()).delete(locals.user!.id, id);
      return { id };
    }),
  }),
};
