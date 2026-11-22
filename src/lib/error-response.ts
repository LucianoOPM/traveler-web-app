/**
 * Conversión de errores a respuestas HTTP uniformes y registro controlado de los
 * inesperados. Funciones puras salvo `console.error` (único punto de registro; si
 * más adelante se elige una biblioteca de logging, solo cambia `escribirRegistro`).
 *
 * Reglas de seguridad (ver ADR-019):
 * - Solo `instanceof AppError` es un error tipado; cualquier otro valor lanzado es inesperado.
 * - Un error inesperado (o un `InternalError`) responde siempre con un mensaje genérico.
 * - Nunca se serializa ni se registra el mensaje, la `cause`, el objeto `Error`, la
 *   solicitud, cabeceras, cuerpo ni la query string.
 */
import { AppError, ERROR_CODE_PATTERN, ValidationError } from "./errors";

export const INTERNAL_ERROR_MESSAGE = "Error interno del servidor";

export type ErrorContext = {
  method: string;
  /** Ruta de la solicitud. Se registra solo el pathname (sin query ni fragmento). */
  path: string;
  /** Incluir frames saneados en el registro (solo fuera de producción). */
  includeFrames?: boolean;
};

const NAME_PATTERN = /^[A-Za-z0-9_$.]{1,80}$/;
const CODE_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
const METHOD_PATTERN = /^[A-Z]{1,10}$/;
const FUNCTION_PATTERN = /^[A-Za-z0-9_$.<>]{1,80}$/;
const LOCATION_PATTERN = /^[\w$./@\-[\]+]{1,200}:\d+:\d+$/;
const MAX_FRAMES = 5;
const MAX_PATH_LENGTH = 200;

/** Ejecuta `fn`; si lanza (getter o Proxy hostil, valor raro), devuelve `respaldo`. */
function seguro<T>(fn: () => T, respaldo: T): T {
  try {
    return fn();
  } catch {
    return respaldo;
  }
}

function serializarDetalles(details: readonly unknown[]): { field: string; message: string }[] {
  // Solo field y message: se descarta cualquier otra propiedad y cualquier elemento que no sea objeto.
  return details
    .filter((detalle): detalle is { field: unknown; message: unknown } => {
      return typeof detalle === "object" && detalle !== null;
    })
    .map(({ field, message }) => ({ field: String(field), message: String(message) }));
}

/** Un error tipado solo se serializa si su estado y su código siguen siendo válidos. */
function esTipadoSerializable(error: unknown): error is AppError {
  return (
    error instanceof AppError &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599 &&
    error.status !== 500 &&
    typeof error.code === "string" &&
    ERROR_CODE_PATTERN.test(error.code)
  );
}

function cuerpoTipado(error: AppError): { error: Record<string, unknown> } {
  const cuerpo: Record<string, unknown> = { code: error.code, message: error.message };
  if (error instanceof ValidationError && Array.isArray(error.details)) {
    cuerpo.details = serializarDetalles(error.details);
  }
  return { error: cuerpo };
}

function nombreSeguro(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return NAME_PATTERN.test(error.name) ? error.name : "Error";
}

function codigoSeguro(error: unknown): string | undefined {
  // Solo de instancias de Error: un objeto arbitrario no es una fuente de confianza.
  if (!(error instanceof Error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODE_PATTERN.test(code) ? code : undefined;
}

function rutaSegura(path: string): string {
  const soloRuta = (path.split(/[?#]/)[0] ?? "").slice(0, MAX_PATH_LENGTH);
  return soloRuta.replace(/[^\x21-\x7E]/g, "_");
}

function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, "/").replace(/^\/(?=[A-Za-z]:\/)/, "");
}

function esAbsoluta(ruta: string): boolean {
  return ruta.startsWith("/") || /^[A-Za-z]:\//.test(ruta);
}

function sanearFrame(linea: string, cwd: string): string | undefined {
  const texto = linea.trim();
  if (!texto.startsWith("at ")) return undefined;
  const sinAsync = texto.replace(/^at\s+(async\s+)?/, "");
  const partes = /^(?:(\S+)\s+\((.+)\)|(.+))$/.exec(sinAsync);
  if (!partes) return undefined;
  const funcion = partes[1];
  const ubicacion = partes[2] ?? partes[3] ?? "";
  const pos = /^(.*):(\d+):(\d+)$/.exec(ubicacion);
  if (!pos) return undefined;

  let ruta = normalizarRuta((pos[1] ?? "").replace(/^file:\/\/\/?/, "").split("?")[0] ?? "");
  const base = normalizarRuta(cwd).replace(/\/+$/, "");
  if (esAbsoluta(ruta)) {
    const dentro = ruta.toLowerCase().startsWith(`${base.toLowerCase()}/`);
    ruta = dentro ? ruta.slice(base.length + 1) : (ruta.split("/").pop() ?? "");
  }
  const sitio = `${ruta}:${pos[2]}:${pos[3]}`;
  if (!LOCATION_PATTERN.test(sitio)) return undefined;
  return funcion && FUNCTION_PATTERN.test(funcion) ? `${funcion} (${sitio})` : sitio;
}

function framesSaneados(error: unknown): string[] | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;
  // El mensaje puede contener texto que parezca un frame: se retira (solo su primera aparición,
  // la de la cabecera) antes de analizar, sin dañar las rutas del resto de la pila.
  const pila = error.message ? error.stack.replace(error.message, () => "") : error.stack;
  const cwd = process.cwd();
  const frames: string[] = [];
  for (const linea of pila.split("\n")) {
    const frame = sanearFrame(linea, cwd);
    if (frame) frames.push(frame);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames.length > 0 ? frames : undefined;
}

function escribirRegistro(linea: string): void {
  // El registro nunca debe romper la respuesta.
  try {
    console.error(linea);
  } catch {
    // sin otro canal de respaldo: el registro es solo informativo
  }
}

function registrarInesperado(error: unknown, contexto: ErrorContext): void {
  const method = METHOD_PATTERN.test(contexto.method) ? contexto.method : "UNKNOWN";
  escribirRegistro(
    JSON.stringify({
      time: new Date().toISOString(),
      event: "unexpected_error",
      errorName: seguro(() => nombreSeguro(error), "Error"),
      errorCode: seguro(() => codigoSeguro(error), undefined),
      method,
      path: rutaSegura(contexto.path),
      frames: contexto.includeFrames ? seguro(() => framesSaneados(error), undefined) : undefined,
    }),
  );
}

function respuestaGenerica(): Response {
  return Response.json(
    { error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } },
    { status: 500 },
  );
}

/** No lanza nunca: ante cualquier fallo al convertir o registrar, responde la 500 genérica. */
export function toErrorResponse(error: unknown, contexto: ErrorContext): Response {
  try {
    if (esTipadoSerializable(error)) {
      return Response.json(cuerpoTipado(error), { status: error.status });
    }
  } catch {
    // un error tipado que no se puede serializar se trata como inesperado
  }
  try {
    registrarInesperado(error, contexto);
  } catch {
    // el registro nunca debe romper la respuesta
  }
  return respuestaGenerica();
}
