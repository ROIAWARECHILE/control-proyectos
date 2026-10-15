// Paso 3: compara el respaldo con la base NUEVA, fila por fila y foto por foto.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATOS, TABLAS } from "./comun.mjs";
import { sql } from "./sql.mjs";

const carpeta = process.argv[2] || fs.readdirSync(DATOS).filter(d => d.startsWith("respaldo-")).sort().pop();
const dir = path.join(DATOS, carpeta);
const t = JSON.parse(fs.readFileSync(path.join(dir, "tablas.json"), "utf8"));

const clave = { etapas_catalogo: "n" };
const huella = filas => crypto.createHash("sha256").update(JSON.stringify(filas)).digest("hex").slice(0, 12);
let ok = true;

for(const tabla of TABLAS){
  const k = clave[tabla] || "id";
  const nuevas = await sql(`select coalesce(json_agg(x order by x.${k}), '[]') filas from public.${tabla} x`);
  const filasNuevas = new Map(nuevas[0].filas.map(f => [String(f[k]), f]));
  // compara solo las columnas que existían en la base vieja (la nueva tiene columnas extra, p. ej. completado_ts)
  const faltan = [], distintas = [];
  for(const v of t[tabla]){
    const n = filasNuevas.get(String(v[k]));
    if(!n){ faltan.push(v[k]); continue; }
    for(const col of Object.keys(v)){
      const a = JSON.stringify(v[col]), b = JSON.stringify(n[col]);
      if(a !== b && !(v[col] && n[col] && !isNaN(Date.parse(v[col])) && Date.parse(v[col]) === Date.parse(n[col]))){
        distintas.push(`${v[k]}.${col}`); break;
      }
    }
  }
  const bien = !faltan.length && !distintas.length;
  ok &&= bien;
  console.log(`${bien ? "OK " : "MAL"} ${tabla.padEnd(16)} vieja ${String(t[tabla].length).padStart(5)} · nueva ${String(filasNuevas.size).padStart(5)}` +
    (faltan.length ? ` · faltan ${faltan.length} (${faltan.slice(0, 3).join(", ")})` : "") +
    (distintas.length ? ` · distintas ${distintas.length} (${distintas.slice(0, 3).join(", ")})` : ""));
}

const raiz = path.join(dir, "archivos");
const locales = [];
(function recorrer(d){ for(const e of fs.readdirSync(d, { withFileTypes: true })){
  const p = path.join(d, e.name); e.isDirectory() ? recorrer(p) : locales.push(path.relative(raiz, p).split(path.sep).join("/"));
}})(raiz);
const enBucket = new Set((await sql(`select coalesce(json_agg(name), '[]') n from storage.objects where bucket_id = 'evidencias'`))[0].n);
const faltanFotos = locales.filter(r => !enBucket.has(r));
ok &&= !faltanFotos.length;
console.log(`${faltanFotos.length ? "MAL" : "OK "} fotos            respaldo ${locales.length} · en la base nueva ${enBucket.size}` +
  (faltanFotos.length ? ` · faltan ${faltanFotos.length}` : ""));
console.log(ok ? "\nTODO COINCIDE." : "\nHAY DIFERENCIAS.");
process.exitCode = ok ? 0 : 1;
