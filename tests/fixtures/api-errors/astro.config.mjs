import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // El middleware real importa `auth` (y con él `bun`) de forma dinámica; igual que la app, el
  // build bajo Node deja `bun` como importación externa. Estas pruebas nunca entran en `/admin`.
  vite: { build: { rolldownOptions: { external: ["bun"] } } },
});
