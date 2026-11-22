/**
 * Instala el hook de commits de TravelTech configurando `core.hooksPath` a `.githooks`.
 * Lo ejecuta el script `prepare` (es decir, `bun install`). Es idempotente y nunca debe romper la
 * instalación: fuera de un repositorio Git (o sin `git`) termina con éxito sin tocar nada, y si ya
 * hay un `core.hooksPath` local distinto lo respeta y avisa de que el hook NO quedó activado.
 */

const RUTA_HOOKS = ".githooks";

type ResultadoGit = { codigo: number; salida: string };

function git(args: string[]): ResultadoGit | undefined {
  try {
    const proceso = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
    return { codigo: proceso.exitCode ?? 1, salida: proceso.stdout.toString().trim() };
  } catch {
    return undefined; // `git` no está instalado
  }
}

const repositorio = git(["rev-parse", "--git-dir"]);
if (!repositorio || repositorio.codigo !== 0) {
  console.log("instalar-hooks: no hay repositorio Git; no se configura el hook de commits.");
  process.exit(0);
}

const actual = git(["config", "--local", "--get", "core.hooksPath"]);
const valorActual = actual && actual.codigo === 0 ? actual.salida : "";

if (valorActual === RUTA_HOOKS) {
  console.log(
    `instalar-hooks: el hook de commits ya está instalado (core.hooksPath=${RUTA_HOOKS}).`,
  );
} else if (valorActual !== "") {
  console.warn(
    [
      `ADVERTENCIA: core.hooksPath ya apunta a '${valorActual}'; el hook de commits de TravelTech`,
      `(${RUTA_HOOKS}/commit-msg) no quedó activado y no se ha modificado tu configuración.`,
      `Para activarlo: git config --local core.hooksPath ${RUTA_HOOKS}`,
    ].join("\n"),
  );
} else {
  const resultado = git(["config", "--local", "core.hooksPath", RUTA_HOOKS]);
  if (resultado && resultado.codigo === 0) {
    console.log(`instalar-hooks: hook de commits instalado (core.hooksPath=${RUTA_HOOKS}).`);
  } else {
    console.warn(
      `ADVERTENCIA: no se pudo configurar core.hooksPath; el hook de commits no quedó activado. Ejecuta: git config --local core.hooksPath ${RUTA_HOOKS}`,
    );
  }
}
