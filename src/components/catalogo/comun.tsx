import { isInputError, type ActionError } from "astro:actions";
import { useState, type InputHTMLAttributes } from "react";
import { erroresDeAccion } from "./errores";

export type Errores = { campos: Record<string, string>; general: string | null };
const SIN_ERRORES: Errores = { campos: {}, general: null };

type Resultado<T> = { data: T | undefined; error: ActionError | undefined };

/**
 * Estado de envío de un formulario: ejecuta una llamada a una Action y deja los errores listos para
 * pintar. `previos` son errores locales (p. ej. un importe mal escrito): si los hay, no se llama.
 */
export function useEnvio() {
  const [errores, setErrores] = useState<Errores>(SIN_ERRORES);
  const [enviando, setEnviando] = useState(false);

  async function ejecutar<T>(
    llamada: () => Promise<Resultado<T>>,
    previos: Record<string, string> = {},
  ): Promise<T | null> {
    if (Object.keys(previos).length > 0) {
      setErrores({ campos: previos, general: null });
      return null;
    }
    setErrores(SIN_ERRORES);
    setEnviando(true);
    try {
      const { data, error } = await llamada();
      if (error) {
        setErrores(erroresDeAccion(error, isInputError(error)));
        return null;
      }
      return data as T;
    } catch {
      setErrores({ campos: {}, general: "No se pudo completar la operación; inténtalo de nuevo." });
      return null;
    } finally {
      setEnviando(false);
    }
  }

  return { errores, enviando, ejecutar };
}

export function ErrorGeneral({ mensaje }: { mensaje: string | null }) {
  return mensaje ? <p role="alert">{mensaje}</p> : null;
}

type CampoProps = InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  error?: string;
  multilinea?: boolean;
  onValor: (valor: string) => void;
};

/** Etiqueta + entrada + error junto al campo (el `name` coincide con el de la Action). */
export function Campo({ etiqueta, error, multilinea, onValor, id, ...resto }: CampoProps) {
  const idError = `${id}-error`;
  const comunes = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? idError : undefined,
  };
  return (
    <p>
      <label>
        {etiqueta}
        <br />
        {multilinea ? (
          <textarea
            {...comunes}
            name={resto.name}
            rows={4}
            value={resto.value as string}
            disabled={resto.disabled}
            onChange={(e) => onValor(e.target.value)}
          />
        ) : (
          <input {...comunes} {...resto} onChange={(e) => onValor(e.target.value)} />
        )}
      </label>
      {error && (
        <span id={idError} role="alert">
          {" "}
          {error}
        </span>
      )}
    </p>
  );
}
