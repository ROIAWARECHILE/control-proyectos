// Paso 1: copia de seguridad local de la base VIEJA. Solo lectura.
// Entra como Jefatura (ve todos los proyectos por RLS), baja cada tabla y
// cada foto de evidencia, y verifica el hash SHA-256 de cada foto.
// Uso: node exportar.mjs   ->  datos/respaldo-<fecha>/
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { DATOS, OLD_URL, OLD_ANON, TABLAS, leerEnv, requerir } from "./comun.mjs";

const env = leerEnv();
requerir(env, ["OLD_JEFATURA_EMAIL", "OLD_JEFATURA_PASSWORD"]);

const sb = createClient(OLD_URL, OLD_ANON, { auth: { persistSession: false } });
const { data: login, error: eLogin } = await sb.auth.signInWithPassword({
  email: env.OLD_JEFATURA_EMAIL, password: env.OLD_JEFATURA_PASSWORD,
});
if(eLogin) throw new Error(`No se pudo entrar a la base vieja: ${eLogin.message}`);

const { data: yo } = await sb.from("profiles").select("nombre, rol").eq("id", login.user.id).single();
console.log(`Sesión en la base vieja: ${yo?.nombre} (${yo?.rol})`);
if(yo?.rol !== "jefatura") throw new Error("La cuenta no es Jefatura: no vería todos los proyectos.");

async function todo(tabla){
  const filas = [];
  for(let desde = 0; ; desde += 1000){
    const { data, error } = await sb.from(tabla).select("*").range(desde, desde + 999);
    if(error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...data);
    if(data.length < 1000) return filas;
  }
}

const sello = new Date().toISOString().replace(/[:.]/g, "-");
const destino = path.join(DATOS, `respaldo-${sello}`);
fs.mkdirSync(path.join(destino, "archivos"), { recursive: true });

const tablas = {};
for(const t of TABLAS){
  tablas[t] = await todo(t);
  console.log(`  ${t.padEnd(16)} ${tablas[t].length}`);
}

// Archivos: los referenciados en "evidencias" + cualquier archivo suelto en el bucket.
const rutas = new Set(tablas.evidencias.map(e => e.storage_path));
async function listar(prefijo){
  const { data, error } = await sb.storage.from("evidencias").list(prefijo, { limit: 1000 });
  if(error) throw new Error(`listar ${prefijo}: ${error.message}`);
  for(const o of data){
    const ruta = prefijo ? `${prefijo}/${o.name}` : o.name;
    if(o.id) rutas.add(ruta); else await listar(ruta);   // sin id = carpeta
  }
}
await listar("");

const hashPorRuta = new Map(tablas.evidencias.map(e => [e.storage_path, e.hash_sha256]));
let bajados = 0, hashMal = 0;
const fallidos = [];
for(const ruta of rutas){
  const { data: blob, error } = await sb.storage.from("evidencias").download(ruta);
  if(error){ fallidos.push(`${ruta}: ${error.message}`); continue; }
  const buf = Buffer.from(await blob.arrayBuffer());
  const archivo = path.join(destino, "archivos", ruta);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, buf);
  const esperado = hashPorRuta.get(ruta);
  if(esperado && crypto.createHash("sha256").update(buf).digest("hex") !== esperado) hashMal++;
  bajados++;
}

const sueltos = [...rutas].filter(r => !hashPorRuta.has(r));
const resumen = {
  exportado: new Date().toISOString(), cuenta: yo.nombre,
  totales: Object.fromEntries(TABLAS.map(t => [t, tablas[t].length])),
  archivos: { encontrados: rutas.size, bajados, hash_distinto: hashMal, sin_fila_en_evidencias: sueltos, fallidos },
};
fs.writeFileSync(path.join(destino, "tablas.json"), JSON.stringify(tablas, null, 1));
fs.writeFileSync(path.join(destino, "resumen.json"), JSON.stringify(resumen, null, 2));
await sb.auth.signOut();

console.log(`  archivos         ${bajados}/${rutas.size} bajados · hash distinto: ${hashMal} · sueltos: ${sueltos.length} · fallidos: ${fallidos.length}`);
fallidos.forEach(f => console.log("    FALLÓ " + f));
console.log(`Respaldo en: ${destino}`);
