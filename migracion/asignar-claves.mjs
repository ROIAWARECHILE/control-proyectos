// Paso 4: deja a cada cuenta con su correo y su MISMA clave de la app vieja.
// Por cada par (correo, clave) de .env.admin: entra a la base VIEJA para
// comprobar que la clave es correcta y saber qué usuario es (mismo id en la
// nueva), y recién ahí le asigna ese correo y esa clave en la base NUEVA.
// Nunca imprime claves.
import { createClient } from "@supabase/supabase-js";
import { OLD_URL, OLD_ANON, leerEnv } from "./comun.mjs";

const env = leerEnv();
const pares = [
  [env.OLD_JEFATURA_EMAIL, env.OLD_JEFATURA_PASSWORD],
  [env.COORD_EMAIL, env.COORD_PASSWORD],
].filter(([e, p]) => e && p);
if(!pares.length) throw new Error("No hay correos/claves en .env.admin");

const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
if(!r.ok) throw new Error(`No se pudo obtener la clave de servicio: ${r.status}`);
const claves = await r.json();
const servicio = (claves.find(k => k.name === "service_role" && k.api_key) || claves.find(k => k.type === "secret" && k.api_key))?.api_key;
const nueva = createClient(`https://${env.SUPABASE_PROJECT_REF}.supabase.co`, servicio, { auth: { persistSession: false } });

for(const [email, password] of pares){
  const vieja = createClient(OLD_URL, OLD_ANON, { auth: { persistSession: false } });
  const { data, error } = await vieja.auth.signInWithPassword({ email, password });
  if(error){ console.log(`✗ ${email}: la clave no funciona en la base vieja (${error.message}); no se cambió nada`); continue; }
  const id = data.user.id;
  const { data: perfil } = await vieja.from("profiles").select("nombre, rol").eq("id", id).single();
  await vieja.auth.signOut();

  const { error: e2 } = await nueva.auth.admin.updateUserById(id, { email, password, email_confirm: true });
  if(e2){ console.log(`✗ ${email}: no se pudo asignar en la base nueva (${e2.message})`); continue; }

  // prueba real: entrar a la base nueva con ese correo y esa clave
  const prueba = createClient(`https://${env.SUPABASE_PROJECT_REF}.supabase.co`, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error: e3 } = await prueba.auth.signInWithPassword({ email, password });
  const { count } = e3 ? { count: "-" } : await prueba.from("proyectos").select("*", { count: "exact", head: true });
  await prueba.auth.signOut();
  console.log(`${e3 ? "✗" : "✓"} ${perfil?.nombre} (${perfil?.rol}) → ${email}` +
    (e3 ? ` · no pudo entrar a la base nueva: ${e3.message}` : ` · entra a la base nueva y ve ${count} proyectos`));
}
