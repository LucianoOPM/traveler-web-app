import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { ConfigError, loadConfig } from "./src/lib/config.ts";

// Valida la configuración al iniciar `astro dev` y `astro build`. No se valida en
// `astro check` ni `astro sync`, para poder comprobar tipos sin secretos (CI).
const validarConfiguracion = {
  name: "validar-configuracion",
  hooks: {
    "astro:config:setup": ({ command }) => {
      if (command !== "dev" && command !== "build") return;
      const raw = { ...loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), ""), ...process.env };
      try {
        loadConfig(raw);
      } catch (error) {
        if (error instanceof ConfigError) {
          // Solo nombres de variable y reglas; nunca valores.
          throw new Error(error.message);
        }
        throw error;
      }
    },
  },
};

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), validarConfiguracion],
});
