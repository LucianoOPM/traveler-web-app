import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { comprobarConfiguracion } from "./src/lib/config.ts";

// Comprueba la configuración al iniciar `astro dev` y `astro build` (no en `astro check`, para
// poder comprobar tipos sin secretos). En producción lo hace `scripts/start.ts`.
// Nota: `env.schema` de Astro no sirve aquí: no falla el build ni el arranque si falta una variable.
const validarConfiguracion = {
  name: "validar-configuracion",
  hooks: {
    "astro:config:setup": ({ command }) => {
      if (command !== "dev" && command !== "build") return;
      const env = {
        ...loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), ""),
        ...process.env,
      };
      const problemas = comprobarConfiguracion(env);
      if (problemas.length > 0) {
        throw new Error(`Configuración inválida:\n- ${problemas.join("\n- ")}`);
      }
    },
  },
};

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), validarConfiguracion],
  // `bun` (driver `bun-sql`) solo existe al ejecutar bajo Bun (`bun run start`); el build corre
  // bajo Node y no puede resolverlo, así que se deja como importación externa.
  vite: { build: { rolldownOptions: { external: ["bun"] } } },
});
