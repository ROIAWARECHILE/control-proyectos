// Paso 2: carga el respaldo local en la base NUEVA, con los mismos ids.
// Se puede repetir: lo que ya existe no se duplica (on conflict).
// Uso: node importar.mjs [carpeta-respaldo]   (por defecto, el más reciente)
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DATOS, TABLAS, leerEnv } from "./comun.mjs";
import { sql } from "./sql.mjs";

const env = leerEnv();
const ADMIN_EMAIL = "trayenkooliva@gmail.com";   // única cuenta con correo real por ahora
const ADMIN_NOMBRE = "Trayenko Oliva";

const carpeta = process.argv[2] || fs.readdirSync(DATOS).filter(d => d.startsWith("respaldo-")).sort().pop();
const dir = path.join(DATOS, carpeta);
const t = JSON.parse(fs.readFileSync(path.join(dir, "tablas.json"), "utf8"));
console.log(`Respaldo: ${carpeta}`);

const lit = v => { const s = JSON.stringify(v); if(s.includes("$mig$")) throw new Error("dato con $mig$"); return `$mig$${s}$mig$`; };

// ---------- 1. usuarios (auth) con los mismos ids ----------
// Sin contraseña: cada uno entra con "¿Olvidaste tu contraseña?" una vez que
// tenga su correo real. Los demás quedan con un correo provisorio.
const usuarios = t.profiles.map(p => ({
  id: p.id, nombre: p.nombre, created_at: p.created_at,
  email: p.nombre === ADMIN_NOMBRE && p.rol === "jefatura" ? ADMIN_EMAIL : `pendiente-${p.id.slice(0, 8)}@controlproyectos.site`,
}));
if(!usuarios.some(u => u.email === ADMIN_EMAIL)) throw new Error(`No encontré a ${ADMIN_NOMBRE} (jefatura) en el respaldo.`);

await sql(`
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nombre', u.nombre),
    u.created_at, now(), '', '', '', ''
  from json_to_recordset(${lit(usuarios)}) as u(id uuid, email text, nombre text, created_at timestamptz)
  on conflict (id) do nothing;

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
    'email', now(), now()
  from json_to_recordset(${lit(usuarios)}) as u(id uuid, email text)
  where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  -- el trigger handle_new_user() creó los perfiles; se dejan idénticos a los originales
  update public.profiles p set nombre = x.nombre, rol = x.rol, activo = x.activo, created_at = x.created_at
  from json_populate_recordset(null::public.profiles, ${lit(t.profiles)}) x where p.id = x.id;
`);
console.log(`  usuarios          ${usuarios.length}`);

// ---------- 2. tablas ----------
// Catálogo e instaladores: se sobrescriben con lo de la base vieja (puede
// tener ediciones de Jefatura distintas de la semilla del esquema).
const sobrescribir = {
  etapas_catalogo: "on conflict (n) do update set nombre = excluded.nombre, hito = excluded.hito",
  items_catalogo: `on conflict (id) do update set etapa_n = excluded.etapa_n, texto = excluded.texto,
    evidencia = excluded.evidencia, aplica_tipos = excluded.aplica_tipos, orden = excluded.orden,
    activo = excluded.activo, created_at = excluded.created_at`,
  // el esquema siembra los mismos nombres con otros ids: se reemplazan por los originales
  instaladores: `on conflict (lower(nombre)) do update set id = excluded.id, nombre = excluded.nombre,
    activo = excluded.activo, created_at = excluded.created_at`,
};
const identidad = new Set(["auditoria", "notificaciones"]);   // id "generated always": hay que forzar el original

for(const tabla of TABLAS.filter(x => x !== "profiles")){
  const filas = t[tabla];
  for(let i = 0; i < filas.length; i += 400){
    const lote = filas.slice(i, i + 400);
    await sql(`insert into public.${tabla} ${identidad.has(tabla) ? "overriding system value" : ""}
      select * from json_populate_recordset(null::public.${tabla}, ${lit(lote)})
      ${sobrescribir[tabla] || "on conflict do nothing"};`);
  }
  console.log(`  ${tabla.padEnd(17)} ${filas.length}`);
}

// contadores: que lo nuevo siga después de lo migrado
await sql(`
  select setval('public.proyecto_seq', greatest(2050, (select coalesce(max(substring(id from 3)::int), 0) from public.proyectos where id ~ '^P-[0-9]+$')));
  select setval(pg_get_serial_sequence('public.auditoria', 'id'), greatest(1, (select coalesce(max(id), 0) from public.auditoria)));
  select setval(pg_get_serial_sequence('public.notificaciones', 'id'), greatest(1, (select coalesce(max(id), 0) from public.notificaciones)));
`);

// ---------- 3. fotos de evidencia (mismas rutas) ----------
// Se sube con la clave de servicio, que se pide a la Management API en memoria:
// nunca se imprime ni se guarda en disco.
const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
if(!r.ok) throw new Error(`No se pudo obtener la clave de servicio: ${r.status}`);
const claves = await r.json();
const servicio = (claves.find(k => k.name === "service_role" && k.api_key) || claves.find(k => k.type === "secret" && k.api_key))?.api_key;
if(!servicio) throw new Error("No hay clave de servicio disponible.");
const sb = createClient(`https://${env.SUPABASE_PROJECT_REF}.supabase.co`, servicio, { auth: { persistSession: false } });

const raiz = path.join(dir, "archivos");
const archivos = [];
(function recorrer(d){ for(const e of fs.readdirSync(d, { withFileTypes: true })){
  const p = path.join(d, e.name); e.isDirectory() ? recorrer(p) : archivos.push(path.relative(raiz, p).split(path.sep).join("/"));
}})(raiz);

const mime = new Map(t.evidencias.map(e => [e.storage_path, e.mime || "image/jpeg"]));
let subidos = 0, yaEstaban = 0; const fallidos = [];
for(let i = 0; i < archivos.length; i += 6){
  await Promise.all(archivos.slice(i, i + 6).map(async ruta => {
    const { error } = await sb.storage.from("evidencias").upload(ruta, fs.readFileSync(path.join(raiz, ruta)),
      { contentType: mime.get(ruta) || "image/jpeg", upsert: false });
    if(!error) subidos++;
    else if(/exists|Duplicate/i.test(error.message)) yaEstaban++;
    else fallidos.push(`${ruta}: ${error.message}`);
  }));
}
console.log(`  fotos             ${subidos} subidas · ${yaEstaban} ya estaban · ${fallidos.length} fallidas`);
fallidos.slice(0, 10).forEach(f => console.log("    FALLÓ " + f));
