// Utilidades compartidas por los scripts de migración.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATOS = path.join(DIR, "datos");

// Base VIEJA: URL y clave pública (las mismas que tenía js/config.js, no son secretas).
export const OLD_URL = "https://djgrqunkbrppcqhfelyi.supabase.co";
export const OLD_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZ3JxdW5rYnJwcGNxaGZlbHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMjg1NzgsImV4cCI6MjA3MTcwNDU3OH0.J3PyFqZ8-kAonplvQuapg8vg0IIQwiKVd7yEuVVqrfw";

// Tablas en orden de dependencias (las referenciadas primero).
export const TABLAS = [
  "profiles", "etapas_catalogo", "items_catalogo", "instaladores",
  "proyectos", "evidencias", "item_avance", "auditoria", "notificaciones",
];

// Lee .env.admin sin imprimir nada de su contenido.
export function leerEnv(){
  const txt = fs.readFileSync(path.join(DIR, "..", ".env.admin"), "utf8");
  const env = {};
  for(const linea of txt.split(/\r?\n/)){
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if(m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

export function requerir(env, claves){
  const faltan = claves.filter(k => !env[k]);
  if(faltan.length) throw new Error(`Faltan en .env.admin: ${faltan.join(", ")}`);
}
