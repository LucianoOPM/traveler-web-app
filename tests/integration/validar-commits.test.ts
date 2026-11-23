import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lanzar } from "../support/servidor";

// Pruebas con repositorios Git temporales REALES: ejecutan el CLI `scripts/validar-commits.ts`
// sobre rangos de commits y comprueban los códigos de salida (0 válido, 1 inválido, 2 uso/Git).

const raiz = path.resolve(import.meta.dir, "../..");
const cli = path.join(raiz, "scripts/validar-commits.ts");

const temporales: string[] = [];

afterAll(async () => {
  await Promise.all(temporales.map((dir) => rm(dir, { recursive: true, force: true })));
});

type Resultado = { codigo: number; salida: string };

async function ejecutar(comando: string[], cwd: string): Promise<Resultado> {
  const proceso = lanzar(comando, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
  });
  const codigo = await proceso.salio;
  return { codigo, salida: proceso.salida() };
}

const git = (cwd: string, ...args: string[]) => ejecutar(["git", ...args], cwd);
const validar = (cwd: string, ...args: string[]) => ejecutar(["bun", cli, ...args], cwd);

async function crearRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "traveltech-commits-"));
  temporales.push(dir);
  await git(dir, "init", "-q", "-b", "principal");
  await git(dir, "config", "user.name", "Prueba");
  await git(dir, "config", "user.email", "prueba@example.com");
  await git(dir, "config", "commit.gpgsign", "false");
  return dir;
}

async function commit(dir: string, mensaje: string): Promise<string> {
  const { codigo, salida } = await git(
    dir,
    "commit",
    "--allow-empty",
    "--no-verify",
    "-q",
    "-m",
    mensaje,
  );
  expect({ codigo, salida }).toEqual({ codigo: 0, salida: expect.any(String) });
  return sha(dir, "HEAD");
}

async function sha(dir: string, ref: string): Promise<string> {
  const { salida } = await git(dir, "rev-parse", ref);
  return salida.trim();
}

describe("validar-commits (CLI) con Git real", () => {
  test("sale con 1 y nombra solo los commits inválidos, incluso con un merge en el rango", async () => {
    const repo = await crearRepo();
    const base = await commit(repo, "chore: base");
    await git(repo, "switch", "-q", "-c", "rama");
    const valido = await commit(repo, "feat(h0): válido");
    const invalido = await commit(repo, "arreglos varios");
    await git(repo, "switch", "-q", "principal");
    await commit(repo, "chore: avance en principal");
    await git(repo, "merge", "--no-ff", "--no-verify", "-q", "-m", "Merge rama", "rama");

    const resultado = await validar(repo, base, await sha(repo, "HEAD"));
    expect(resultado.codigo).toBe(1);
    expect(resultado.salida).toContain(invalido.slice(0, 7));
    expect(resultado.salida).not.toContain(valido.slice(0, 7));
  }, 60_000);

  test("sale con 0 si todos los commits del rango son válidos", async () => {
    const repo = await crearRepo();
    const base = await commit(repo, "chore: base");
    await commit(repo, "feat: uno");
    await commit(repo, "fix(h0): dos");
    const resultado = await validar(repo, base, await sha(repo, "HEAD"));
    expect(resultado.codigo).toBe(0);
  }, 60_000);

  test("sale con 0 si el rango está vacío (base == head)", async () => {
    const repo = await crearRepo();
    const base = await commit(repo, "arreglos varios");
    const resultado = await validar(repo, base, base);
    expect(resultado.codigo).toBe(0);
    expect(resultado.salida).toContain("No hay commits que validar");
  }, 60_000);

  test("sale con 2 si un argumento no es un SHA completo, sin pasárselo a git", async () => {
    const repo = await crearRepo();
    const head = await commit(repo, "chore: base");
    for (const base of ["--all", "", "abc123", "HEAD"]) {
      const resultado = await validar(repo, base, head);
      expect({ base, codigo: resultado.codigo }).toEqual({ base, codigo: 2 });
      expect(resultado.salida).toContain("SHA");
    }
  }, 60_000);

  test("sale con 2 y un mensaje claro si el commit base no existe", async () => {
    const repo = await crearRepo();
    const head = await commit(repo, "chore: base");
    const resultado = await validar(repo, "0".repeat(40), head);
    expect(resultado.codigo).toBe(2);
    expect(resultado.salida).toContain("git log");
  }, 60_000);

  test("sale con 2 y el uso si faltan argumentos", async () => {
    const repo = await crearRepo();
    const resultado = await validar(repo);
    expect(resultado.codigo).toBe(2);
    expect(resultado.salida).toContain("Uso:");
  }, 60_000);
});
