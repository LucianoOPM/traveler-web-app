import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { abrirBase } from "../../db/conexion";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL: es obligatoria");

const ac = createAccessControl(defaultStatements);

// Mínimo privilegio: `operator` no tiene permisos de administración de usuarios.
const roles = { admin: ac.newRole(adminAc.statements), operator: ac.newRole({}) };

/** Better Auth solo para personal. Solo genera el esquema; el handler se monta en una issue posterior. */
export const auth = betterAuth({
  database: drizzleAdapter(abrirBase(url).db, { provider: "pg", schema }),
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.APP_ORIGIN,
  advanced: { database: { generateId: "uuid" } },
  // Registro cerrado: el personal lo crea un admin (`admin:create` y el plugin Admin).
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [admin({ ac, roles, defaultRole: "operator", adminRoles: ["admin"] })],
});
