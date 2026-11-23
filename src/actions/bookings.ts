import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { baseDelServidor } from "@db/servidor";
import { TooManyRequestsError } from "@lib/errors";
import { crearReservas } from "@modules/bookings/container";
import { LIMITE_RESERVAS, LimiteDeSolicitudes } from "@modules/bookings/domain/rate-limit";
import { MAX_PASAJEROS } from "@modules/bookings/domain/booking-rules";
import { CATEGORIAS_TARIFA } from "@modules/bookings/schema";
import { conErrores } from "./con-errores";

// Action pública (sin sesión): solo valida la forma; las reglas de la reserva viven en
// `BookingService` (ADR-025, ADR-026). La base la elige el servidor: la entrada es estricta, así que
// un `role`, `demoMode` o `database` enviado por el cliente se rechaza como clave desconocida.
const limite = new LimiteDeSolicitudes(LIMITE_RESERVAS.max, LIMITE_RESERVAS.ventanaMs);

const texto = (max: number) =>
  z.string().trim().min(1, "Este campo es obligatorio").max(max, `Máximo ${max} caracteres`);

export const bookings = {
  create: defineAction({
    input: z.strictObject({
      departureId: z.uuid("Salida no válida"),
      boardingPointId: z.uuid("Selecciona un punto de abordaje"),
      buyerName: texto(120),
      buyerPhone: texto(30),
      buyerEmail: z
        .string()
        .trim()
        .max(254, "Máximo 254 caracteres")
        .pipe(z.email("Correo no válido")),
      passengers: z
        .array(
          z.strictObject({
            fullName: texto(120),
            fareCategory: z.enum(CATEGORIAS_TARIFA, "Categoría no válida"),
          }),
        )
        .min(1, "Agrega al menos un pasajero")
        .max(MAX_PASAJEROS, `Máximo ${MAX_PASAJEROS} pasajeros`),
    }),
    handler: conErrores("bookings.create", async (input, { clientAddress }) => {
      // Cuenta toda solicitud con forma válida, cree o no la reserva. La IP es la del socket que da
      // Astro; no se leen cabeceras reenviadas.
      if (!limite.intentar(clientAddress)) {
        throw new TooManyRequestsError("Demasiadas solicitudes; inténtalo de nuevo más tarde");
      }
      const { bookings } = crearReservas(await baseDelServidor());
      const { booking, token } = await bookings.create(input);
      // El token solo sale aquí, una vez; en la base solo queda su hash.
      return {
        reference: booking.reference,
        token,
        totalCents: booking.totalCents,
        expiresAt: booking.expiresAt,
      };
    }),
  }),
};
