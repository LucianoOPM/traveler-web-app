import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lanzar } from "../support/servidor";

// Pruebas con repositorios Git temporales REALES: comprueban el flujo completo
// (git commit → .githooks/commit-msg → scripts/commit-msg.ts) y la instalación (`prepare`).

const raiz = path.resolve(import.meta.dir, "../..");
const hooksDir = path.join(raiz, ".githooks").replaceAll("\\", "/");
const hook = path.join(raiz, ".githooks/commit-msg");
const instalador = path.join(raiz, "scripts/instalar-hooks.ts");

const temporales: string[] = [];

afterAll(async () => {
  await Promise.all(temporales.map((dir) => rm(dir, { recursive: true, force: true })));
});

type Resultado = { codigo: number; salida: string };

async function ejecutar(
  comando: string[],
  cwd: string,
  env: Record<string, string | undefined> = {},
): Promise<Resultado> {
  const proceso = lanzar(comando, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CEILING_DIRECTORIES: path.dirname(cwd),
      ...env,
    },
  });
  const codigo = await proceso.salio;
  return { codigo, salida: proceso.salida() };
}

const git = (cwd: string, ...args: string[]) => ejecutar(["git", ...args], cwd);

async function directorioTemporal(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "traveltech-hook-"));
  temporales.push(dir);
  return dir;
}

async function crearRepo(opciones: { conHook?: boolean } = {}): Promise<string> {
  const dir = await directorioTemporal();
  await git(dir, "init", "-q", "-b", "principal");
  await git(dir, "config", "user.name", "Prueba");
  await git(dir, "config", "user.email", "prueba@example.com");
  await git(dir, "config", "commit.gpgsign", "false");
  if (opciones.conHook !== false) await git(dir, "config", "core.hooksPath", hooksDir);
  return dir;
}

async function totalDeCommits(dir: string): Promise<number> {
  const { codigo, salida } = await git(dir, "rev-list", "--count", "HEAD");
  return codigo === 0 ? Number(salida.trim()) : 0;
}

describe("hook commit-msg con Git real", () => {
  test("rechaza un commit con mensaje no convencional", async () => {
    const repo = await crearRepo();
    const resultado = await git(repo, "commit", "--allow-empty", "-m", "mensaje malo");
    expect(resultado.codigo).not.toBe(0);
    expect(resultado.salida).toContain("Conventional Commits");
    expect(await totalDeCommits(repo)).toBe(0);
  }, 60_000);

  test("acepta un commit con mensaje convencional", async () => {
    const repo = await crearRepo();
    const resultado = await git(repo, "commit", "--allow-empty", "-m", "feat(h0): mensaje válido");
    expect(resultado.codigo).toBe(0);
    expect(await totalDeCommits(repo)).toBe(1);
  }, 60_000);

  test("acepta las excepciones de Git", async () => {
    const repo = await crearRepo();
    const base = await git(repo, "commit", "--allow-empty", "-m", "chore: base");
    expect(base.codigo).toBe(0);

    // `git revert` y `git cherry-pick` NO ejecutan commit-msg (Git no lo invoca): esta parte no
    // prueba el hook, solo que no rompe el flujo; el prefijo `Revert "` lo cubre la prueba unitaria.
    await Bun.write(path.join(repo, "a.txt"), "uno\n");
    await git(repo, "add", "a.txt");
    expect((await git(repo, "commit", "-m", "feat: añadir archivo")).codigo).toBe(0);
    const revertir = await git(repo, "revert", "--no-edit", "HEAD");
    expect(revertir.codigo).toBe(0);
    const asunto = await git(repo, "log", "-1", "--format=%s");
    expect(asunto.salida.trim()).toStartWith('Revert "');

    // Autosquash.
    expect((await git(repo, "commit", "--allow-empty", "--fixup=HEAD")).codigo).toBe(0);
    expect((await git(repo, "commit", "--allow-empty", "-m", "squash! chore: base")).codigo).toBe(
      0,
    );

    // Merge local con el mensaje por defecto de Git.
    await git(repo, "checkout", "-q", "-b", "rama");
    expect((await git(repo, "commit", "--allow-empty", "-m", "feat: en la rama")).codigo).toBe(0);
    await git(repo, "checkout", "-q", "principal");
    expect((await git(repo, "commit", "--allow-empty", "-m", "fix: en principal")).codigo).toBe(0);
    const fusion = await git(repo, "merge", "--no-ff", "--no-edit", "rama");
    expect(fusion.codigo).toBe(0);
    const asuntoFusion = await git(repo, "log", "-1", "--format=%s");
    expect(asuntoFusion.salida.trim()).toStartWith("Merge branch");
  }, 120_000);

  test("--no-verify permite saltarse la validación", async () => {
    const repo = await crearRepo();
    const resultado = await git(
      repo,
      "commit",
      "--allow-empty",
      "--no-verify",
      "-m",
      "mensaje malo a propósito",
    );
    expect(resultado.codigo).toBe(0);
    expect(await totalDeCommits(repo)).toBe(1);
  }, 60_000);
});

describe("el hook como archivo", () => {
  const sh = Bun.which("sh");
  const dirSh = sh ? path.dirname(sh) : "";
  const bunAlcanzable = Boolean(sh && Bun.which("bun", { PATH: dirSh }));

  test.skipIf(!sh || bunAlcanzable)(
    "bloquea con un mensaje claro si Bun no está en el PATH",
    async () => {
      const dir = await directorioTemporal();
      const archivo = path.join(dir, "COMMIT_EDITMSG");
      await Bun.write(archivo, "feat: mensaje válido\n");
      const resultado = await ejecutar(["sh", hook, archivo], dir, {
        PATH: dirSh,
        Path: dirSh,
      });
      expect(resultado.codigo).toBe(1);
      expect(resultado.salida).toContain("Bun");
      expect(resultado.salida).toContain("--no-verify");
    },
    60_000,
  );

  test("el índice guarda el hook con modo ejecutable y saltos de línea LF", async () => {
    const modo = await git(raiz, "ls-files", "-s", ".githooks/commit-msg");
    expect(modo.codigo).toBe(0);
    expect(modo.salida).toStartWith("100755");
    const eol = await git(raiz, "ls-files", "--eol", ".githooks/commit-msg");
    expect(eol.salida).toContain("i/lf");
  }, 60_000);
});

describe("prepare (scripts/instalar-hooks.ts)", () => {
  test("prepare instala core.hooksPath en un repositorio Git", async () => {
    const repo = await crearRepo({ conHook: false });
    const resultado = await ejecutar(["bun", instalador], repo);
    expect(resultado.codigo).toBe(0);
    const config = await git(repo, "config", "--local", "core.hooksPath");
    expect(config.salida.trim()).toBe(".githooks");

    // Idempotente: una segunda ejecución no cambia nada ni falla.
    const otra = await ejecutar(["bun", instalador], repo);
    expect(otra.codigo).toBe(0);
    const despues = await git(repo, "config", "--local", "--get-all", "core.hooksPath");
    expect(despues.salida.trim()).toBe(".githooks");
  }, 60_000);

  test("prepare no falla fuera de un repositorio Git", async () => {
    const dir = await directorioTemporal();
    const resultado = await ejecutar(["bun", instalador], dir);
    expect(resultado.codigo).toBe(0);
    expect(await Bun.file(path.join(dir, ".git/config")).exists()).toBe(false);
  }, 60_000);

  test("prepare no pisa un core.hooksPath ajeno", async () => {
    const repo = await crearRepo({ conHook: false });
    await git(repo, "config", "--local", "core.hooksPath", "otro-dir");
    const resultado = await ejecutar(["bun", instalador], repo);
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain("no quedó activado");
    expect(resultado.salida).toContain("otro-dir");
    const config = await git(repo, "config", "--local", "core.hooksPath");
    expect(config.salida.trim()).toBe("otro-dir");
  }, 60_000);

  test("prepare reconoce el hook ya instalado con barra final o ruta absoluta", async () => {
    const repo = await crearRepo({ conHook: false });
    for (const valor of [".githooks/", path.join(repo, ".githooks").replaceAll("\\", "/")]) {
      await git(repo, "config", "--local", "core.hooksPath", valor);
      const resultado = await ejecutar(["bun", instalador], repo);
      expect(resultado.codigo).toBe(0);
      expect(resultado.salida).not.toContain("no quedó activado");
      expect(resultado.salida).toContain("ya está instalado");
    }
  }, 60_000);

  test("prepare no toca un repositorio padre cuando el proyecto está dentro de otro", async () => {
    const padre = await crearRepo({ conHook: false });
    const proyecto = path.join(padre, "sub", "proyecto");
    await Bun.write(path.join(proyecto, "marcador.txt"), "x\n");
    // El límite de búsqueda de Git queda por encima del repositorio padre para que lo encuentre.
    const resultado = await ejecutar(["bun", instalador], proyecto, {
      GIT_CEILING_DIRECTORIES: path.dirname(padre),
    });
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain("no quedó activado");
    const config = await git(padre, "config", "--local", "--get", "core.hooksPath");
    expect(config.salida.trim()).toBe("");
  }, 60_000);

  test("prepare no anula un core.hooksPath global", async () => {
    const repo = await crearRepo({ conHook: false });
    const globalConfig = path.join(await directorioTemporal(), "gitconfig-global");
    await Bun.write(globalConfig, "[core]\n\thooksPath = /hooks-corporativos\n");
    const resultado = await ejecutar(["bun", instalador], repo, {
      GIT_CONFIG_GLOBAL: globalConfig,
    });
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain("no quedó activado");
    expect(resultado.salida).toContain("/hooks-corporativos");
    const local = await git(repo, "config", "--local", "--get", "core.hooksPath");
    expect(local.salida.trim()).toBe("");
  }, 60_000);

  test("prepare no desactiva hooks que ya existen en .git/hooks", async () => {
    const repo = await crearRepo({ conHook: false });
    await Bun.write(path.join(repo, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 0\n");
    await Bun.write(path.join(repo, ".git/hooks/pre-push.sample"), "#!/bin/sh\nexit 0\n");
    const resultado = await ejecutar(["bun", instalador], repo);
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain("no quedó activado");
    expect(resultado.salida).toContain("pre-commit");
    expect(resultado.salida).not.toContain("pre-push");
    const config = await git(repo, "config", "--local", "--get", "core.hooksPath");
    expect(config.salida.trim()).toBe("");
  }, 60_000);

  test("prepare instala el hook cuando solo hay archivos .sample en .git/hooks", async () => {
    const repo = await crearRepo({ conHook: false });
    await Bun.write(path.join(repo, ".git/hooks/pre-commit.sample"), "#!/bin/sh\nexit 0\n");
    const resultado = await ejecutar(["bun", instalador], repo);
    expect(resultado.codigo).toBe(0);
    const config = await git(repo, "config", "--local", "--get", "core.hooksPath");
    expect(config.salida.trim()).toBe(".githooks");
  }, 60_000);
});
