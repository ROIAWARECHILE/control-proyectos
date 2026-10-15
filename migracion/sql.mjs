// Ejecuta SQL en la base NUEVA vía Management API.
// Uso como script: node sql.mjs "select 1"   ·   o importar { sql } desde otro script.
import { leerEnv, requerir } from "./comun.mjs";

const env = leerEnv();
requerir(env, ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]);

export async function sql(query){
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const txt = await r.text();
  if(!r.ok) throw new Error(`SQL ${r.status}: ${txt.slice(0, 500)}`);
  return JSON.parse(txt);
}

if(process.argv[1]?.endsWith("sql.mjs") && process.argv[2]){
  console.table(await sql(process.argv[2]));
}
