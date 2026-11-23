/**
 * Instala el hook de commits de TravelTech configurando `core.hooksPath` a `.githooks`.
 * Lo ejecuta el script `prepare` (es decir, `bun install`). Es idempotente y nunca debe romper la
 * instalación: siempre termina con código 0.
 *
 * No toca configuración ajena. Termina SIN activar el hook, avisando claramente de que no quedó
 * activado, cuando:
 * - no hay repositorio Git (o no hay `git`);
 * - el proyecto está dentro de OTRO repositorio Git (la raíz del repositorio no es la del proyecto);
 * - ya hay un `core.hooksPath` (local o global) que no apunta a `.githooks`;
 * - ya hay hooks activos en `.git/hooks`, que dejarían de ejecutarse al activar `core.hooksPath`.
 */
import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const RUTA_HOOKS = ".githooks";
const proyecto = process.cwd();

type ResultadoGit = { codigo: number; salida: string };

function git(args: string[]): ResultadoGit | undefined {
  try {
    const proceso = Bun.spawnSync(["git", ...args], {
      cwd: proyecto,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { codigo: proceso.exitCode ?? 1, salida: proceso.stdout.toString().trim() };
  } catch {
    return undefined; // `git` no está instalado
  }
}

/** Ruta absoluta y comparable (resuelve enlaces simbólicos y, en Windows, ignora mayúsculas). */
function normalizar(ruta: string): string {
  const absoluta = path.resolve(proyecto, ruta);
  let resuelta: string;
  try {
    resuelta = realpathSync(absoluta);
  } catch {
    // Puede no existir (p. ej. `.githooks` en un repositorio ajeno): se resuelve el directorio padre.
    try {
      resuelta = path.join(realpathSync(path.dirname(absoluta)), path.basename(absoluta));
    } catch {
      resuelta = absoluta;
    }
  }
  const comparable = resuelta.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? comparable.toLowerCase() : comparable;
}

function noActivado(motivo: string): void {
  console.warn(
    [
      `ADVERTENCIA: ${motivo}`,
      `El hook de commits de TravelTech (${RUTA_HOOKS}/commit-msg) no quedó activado y no se ha modificado tu configuración.`,
      `Para activarlo cuando lo decidas: git config --local core.hooksPath ${RUTA_HOOKS}`,
    ].join("\n"),
  );
}

function hooksActivosEnGit(): string[] {
  const ruta = git(["rev-parse", "--git-path", "hooks"]);
  if (!ruta || ruta.codigo !== 0 || ruta.salida === "") return [];
  try {
    return readdirSync(path.resolve(proyecto, ruta.salida)).filter((n) => !n.endsWith(".sample"));
  } catch {
    return []; // el directorio no existe
  }
}

function instalar(): void {
  const raiz = git(["rev-parse", "--show-toplevel"]);
  if (!raiz || raiz.codigo !== 0 || raiz.salida === "") {
    console.log("instalar-hooks: no hay repositorio Git; no se configura el hook de commits.");
    return;
  }
  if (normalizar(raiz.salida) !== normalizar(proyecto)) {
    noActivado(
      `el proyecto está dentro de otro repositorio Git (raíz: ${raiz.salida}); configurar core.hooksPath ahí afectaría a un repositorio ajeno.`,
    );
    return;
  }

  const actual = git(["config", "--get", "core.hooksPath"]);
  const valorActual = actual && actual.codigo === 0 ? actual.salida : "";
  if (valorActual !== "") {
    if (normalizar(valorActual) === normalizar(RUTA_HOOKS)) {
      console.log(
        `instalar-hooks: el hook de commits ya está instalado (core.hooksPath=${valorActual}).`,
      );
    } else {
      noActivado(`core.hooksPath ya apunta a '${valorActual}'.`);
    }
    return;
  }

  const existentes = hooksActivosEnGit();
  if (existentes.length > 0) {
    noActivado(
      `ya hay hooks activos en .git/hooks (${existentes.join(", ")}) y dejarían de ejecutarse al activar core.hooksPath.`,
    );
    return;
  }

  const resultado = git(["config", "--local", "core.hooksPath", RUTA_HOOKS]);
  if (resultado && resultado.codigo === 0) {
    console.log(`instalar-hooks: hook de commits instalado (core.hooksPath=${RUTA_HOOKS}).`);
  } else {
    noActivado("no se pudo escribir core.hooksPath en la configuración local.");
  }
}

try {
  instalar();
} catch (error) {
  // Nunca debe romper `bun install`.
  console.warn(
    `ADVERTENCIA: instalar-hooks falló de forma inesperada (${error instanceof Error ? error.name : "error"}); el hook de commits no quedó activado.`,
  );
}
