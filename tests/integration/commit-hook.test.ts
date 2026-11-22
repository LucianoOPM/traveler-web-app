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

    // Revert automático de Git, con un cambio real que revertir.
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

  test("queda con modo ejecutable y saltos de línea LF en el índice", async () => {
    const indice = await git(raiz, "ls-files", "-s", ".githooks/commit-msg");
    expect(indice.codigo).toBe(0);
    expect(indice.salida).toStartWith("100755");
    expect(await Bun.file(hook).text()).not.toContain("\r");
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
});
