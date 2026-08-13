/* =====================================================================
   CAPA DE DATOS (Supabase)
   Único módulo que habla con la base de datos y con Storage. Las reglas
   de permisos reales viven en supabase/schema.sql (RLS); aquí solo se
   arman las consultas. Si una operación no está permitida para el rol
   actual, Supabase responde con un error que actions.js muestra al usuario.
   ===================================================================== */

/* ---------- arranque ---------- */
async function existenCuentas(){
  const { data, error } = await sb.rpc("existen_cuentas");
  if(error) throw error;
  return !!data;
}

async function cargarEstado(){
  await cargarCatalogo();

  const { data: perfiles, error: e1 } = await sb.from("profiles").select("*");
  if(e1) throw e1;
  S.usuarios = perfiles || [];

  const { data: proys, error: e2 } = await sb.from("proyectos").select("*").order("created_at", {ascending:true});
  if(e2) throw e2;
  S.proyectos = (proys || []).map(mapProyectoRow);
  await cargarTodoElAvance();   // sin esto, las listas y el dashboard mostrarían 0% hasta abrir cada proyecto
  await cargarNotificaciones();

  const H = hoy();
  S.mes = {y: H.getFullYear(), m: H.getMonth()};
}

/* ---------- catálogo de ítems (editable, Menú → Catálogo de ítems) ---------- */
async function cargarCatalogo(){
  const { data: etapas, error: e1 } = await sb.from("etapas_catalogo").select("*").order("n");
  if(e1) throw e1;
  const { data: items, error: e2 } = await sb.from("items_catalogo").select("*")
    .eq("activo", true).order("etapa_n").order("orden");
  if(e2) throw e2;
  ETAPAS = (etapas || []).map(e => ({
    n: e.n, t: e.nombre, hito: e.hito,
    items: (items || []).filter(i => i.etapa_n === e.n)
      .map(i => ({id: i.id, x: i.texto, ev: i.evidencia, ap: (i.aplica_tipos && i.aplica_tipos.length) ? i.aplica_tipos : "*"}))
  }));
}

async function actualizarEtapaCatalogoDB(n, campos){
  const { error } = await sb.from("etapas_catalogo").update(campos).eq("n", n);
  if(error) throw error;
}

async function crearItemCatalogoDB({id, etapaN, texto, evidencia, aplicaTipos, orden}){
  const { error } = await sb.from("items_catalogo").insert({
    id, etapa_n: etapaN, texto, evidencia, aplica_tipos: aplicaTipos, orden
  });
  if(error) throw error;
}

async function actualizarItemCatalogoDB(id, campos){
  const { error } = await sb.from("items_catalogo").update(campos).eq("id", id);
  if(error) throw error;
}

/* activo=false archiva (RN-3-like: nunca se borra), activo=true restaura */
async function archivarItemCatalogoDB(id, activo){
  const { error } = await sb.from("items_catalogo").update({activo}).eq("id", id);
  if(error) throw error;
}

async function cargarItemsArchivadosCatalogoDB(){
  const { data, error } = await sb.from("items_catalogo").select("*").eq("activo", false).order("etapa_n").order("id");
  if(error) throw error;
  return data || [];
}

function mapProyectoRow(row){
  const coordPerfil = S.usuarios.find(u => u.id === row.coordinador_id);
  return {
    id: row.id, nombre: row.nombre, cliente: row.cliente, tipo: row.tipo, linea: row.linea_piscina, comuna: row.comuna,
    coordinadorId: row.coordinador_id, coord: coordPerfil ? coordPerfil.nombre : "Sin asignar",
    inst: row.instalador, inicio: row.fecha_inicio, termino: row.fecha_termino,
    checklist: row.checklist, archivado: row.archivado, archivadoTs: row.archivado_ts,
    creadoPor: row.creado_por, av: {}, avArchivado: []
  };
}

/* ---------- proyectos ---------- */
async function crearProyectoDB(datos){
  const { data, error } = await sb.from("proyectos").insert({
    nombre: datos.nombre, cliente: datos.cliente, tipo: datos.tipo, linea_piscina: datos.linea || null, comuna: datos.comuna,
    instalador: datos.inst, fecha_inicio: datos.inicio, fecha_termino: datos.termino,
    coordinador_id: datos.coordinadorId || null,
    creado_por: S.sesion.userId,
    checklist: snapshotChecklist(datos.tipo)
  }).select().single();
  if(error) throw error;
  return mapProyectoRow(data);
}

/* campos: subconjunto de {nombre, cliente, comuna, inst, inicio, termino} en snake_case de destino */
async function actualizarProyectoDB(id, campos){
  const { data, error } = await sb.from("proyectos").update(campos).eq("id", id).select().single();
  if(error) throw error;
  return mapProyectoRow(data);
}

/* RN-12: cambia el tipo, recalcula el checklist y archiva lo que deja de aplicar. Solo Jefatura (RLS). */
async function cambiarTipoProyectoDB(p, nuevoTipo){
  const nuevoChecklist = snapshotChecklist(nuevoTipo);
  const validos = new Set(nuevoChecklist.etapas.flatMap(e => e.items).map(i => i.id));
  const invalidos = Object.keys(p.av).filter(id => !validos.has(id));
  for(const itemId of invalidos){
    await reabrirAvanceDB(p.id, itemId, `Dejó de aplicar por cambio de tipo (${p.tipo} → ${nuevoTipo})`);
  }
  const { data, error } = await sb.from("proyectos").update({tipo: nuevoTipo, checklist: nuevoChecklist}).eq("id", p.id).select().single();
  if(error) throw error;
  return mapProyectoRow(data);
}

async function archivarProyectoDB(id, archivado){
  const { data, error } = await sb.from("proyectos")
    .update({archivado, archivado_ts: archivado ? new Date().toISOString() : null})
    .eq("id", id).select().single();
  if(error) throw error;
  return mapProyectoRow(data);
}

/* ---------- checklist (avance) ---------- */
function aplicarAvance(p, rows){
  p.av = {}; p.avArchivado = [];
  rows.forEach(row => {
    const entry = {
      ok: row.ok, ts: row.ts, user: row.usuario_nombre, nota: row.nota,
      evidenciaId: row.evidencia_id,
      geo: (row.geo_lat != null && row.geo_lng != null) ? {lat:row.geo_lat, lng:row.geo_lng} : null
    };
    if(row.vigente) p.av[row.item_id] = entry;
    else p.avArchivado.push({itemId: row.item_id, ...entry, archivadoTs: row.archivado_ts, motivo: row.motivo});
  });
}

/* refresca el avance de un solo proyecto (tras registrar/reabrir un ítem) */
async function cargarChecklist(proyectoId){
  const p = S.proyectos.find(x => x.id === proyectoId);
  if(!p) return;
  const { data, error } = await sb.from("item_avance").select("*").eq("proyecto_id", proyectoId).order("ts", {ascending:true});
  if(error) throw error;
  aplicarAvance(p, data || []);
}

/* carga en lote el avance de TODOS los proyectos visibles (evita listas en 0%) */
async function cargarTodoElAvance(){
  if(!S.proyectos.length) return;
  const ids = S.proyectos.map(p => p.id);
  const { data, error } = await sb.from("item_avance").select("*").in("proyecto_id", ids).order("ts", {ascending:true});
  if(error) throw error;
  const porProyecto = new Map();
  (data || []).forEach(row => {
    if(!porProyecto.has(row.proyecto_id)) porProyecto.set(row.proyecto_id, []);
    porProyecto.get(row.proyecto_id).push(row);
  });
  S.proyectos.forEach(p => aplicarAvance(p, porProyecto.get(p.id) || []));
}

async function registrarAvanceDB(proyectoId, itemId, {nota, evidenciaId, geo, conPrevias}){
  const { data, error } = await sb.from("item_avance").insert({
    proyecto_id: proyectoId, item_id: itemId, ok: true,
    usuario_id: S.sesion.userId, usuario_nombre: S.sesion.nombre,
    nota: nota || "", evidencia_id: evidenciaId || null,
    geo_lat: geo ? geo.lat : null, geo_lng: geo ? geo.lng : null,
    con_etapas_previas_incompletas: !!conPrevias
  }).select().single();
  if(error) throw error;
  return data;
}

async function reabrirAvanceDB(proyectoId, itemId, motivo){
  const { error } = await sb.from("item_avance")
    .update({vigente:false, archivado_ts:new Date().toISOString(), motivo})
    .eq("proyecto_id", proyectoId).eq("item_id", itemId).eq("vigente", true);
  if(error) throw error;
}

/* ---------- evidencias ---------- */
async function hashBlob(blob){
  try{
    const buf = await blob.arrayBuffer();
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2,"0")).join("");
  }catch(e){ return null; }
}

async function subirEvidenciaDB(proyectoId, itemId, blob){
  const hash = await hashBlob(blob);
  const path = `${proyectoId}/${itemId}/${uid("")}.jpg`;
  const { error: upErr } = await sb.storage.from("evidencias").upload(path, blob, {contentType: blob.type || "image/jpeg", upsert:false});
  if(upErr) throw upErr;
  const { data, error } = await sb.from("evidencias").insert({
    proyecto_id: proyectoId, item_id: itemId, storage_path: path, mime: blob.type,
    hash_sha256: hash, usuario_id: S.sesion.userId, usuario_nombre: S.sesion.nombre
  }).select().single();
  if(error) throw error;
  return data;
}

/* URLs firmadas (bucket privado): duran 6 horas, suficiente para revisar o imprimir el acta */
async function cargarEvidencias(proyectoId){
  S.evCache.clear();
  const { data, error } = await sb.from("evidencias").select("*").eq("proyecto_id", proyectoId);
  if(error) throw error;
  await Promise.all((data || []).map(async row => {
    const { data: signed, error: e2 } = await sb.storage.from("evidencias").createSignedUrl(row.storage_path, 21600);
    if(e2){ console.error(e2); return; }
    S.evCache.set(row.id, {url: signed.signedUrl, meta: {ts: row.ts, user: row.usuario_nombre, hash: row.hash_sha256}});
  }));
}

/* ---------- usuarios ---------- */
/* Solo Jefatura puede llamarla (RLS/RPC lo verifica server-side, ver schema.sql). */
async function asignarRolDB(usuarioId, nuevoRol){
  const { error } = await sb.rpc("asignar_rol", {usuario_id: usuarioId, nuevo_rol: nuevoRol});
  if(error) throw error;
}

/* ---------- notificaciones (centro de notificaciones, dentro de la app) ---------- */
async function cargarNotificaciones(){
  const { data, error } = await sb.from("notificaciones").select("*").order("created_at", {ascending:false}).limit(30);
  if(error) throw error;
  S.notificaciones = data || [];
}

/* nunca bloquea el registro del ítem si falla (mismo criterio que audit()) */
async function notificarItemCerrado(proyectoId, mensaje){
  try{ await sb.rpc("notificar_item_cerrado", {p_proyecto_id: proyectoId, p_mensaje: mensaje}); }
  catch(e){ console.error("notificacion:", e); }
}

async function marcarNotificacionLeidaDB(id){
  const { error } = await sb.from("notificaciones").update({leida:true}).eq("id", id);
  if(error) throw error;
}
async function marcarTodasNotificacionesLeidasDB(){
  const { error } = await sb.from("notificaciones").update({leida:true}).eq("leida", false);
  if(error) throw error;
}

/* ---------- auditoría ---------- */
async function audit(accion, detalle, proyectoId){
  if(!S.sesion) return;   // sin sesión activa no hay quién firme el registro (RLS lo exige)
  try{
    await sb.from("auditoria").insert({
      proyecto_id: proyectoId || null,
      usuario_id: S.sesion.userId, usuario_nombre: S.sesion.nombre, rol: S.sesion.rol,
      accion, detalle: detalle || ""
    });
  }catch(e){ console.error("auditoria:", e); }
}

async function cargarAuditoria(proyectoId){
  const { data, error } = await sb.from("auditoria").select("*").eq("proyecto_id", proyectoId).order("ts", {ascending:false}).limit(30);
  if(error) throw error;
  S.auditProy = (data || []).map(r => ({ts:r.ts, user:r.usuario_nombre, rol:r.rol, accion:r.accion, detalle:r.detalle}));
}

/* ---------- respaldo (copia manual de lo que el usuario puede ver) ---------- */
function blobToB64(blob){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

async function exportarDatos(){
  const detalle = [];
  for(const p of S.proyectos){
    const [{data:avance}, {data:evid}, {data:auditoria}] = await Promise.all([
      sb.from("item_avance").select("*").eq("proyecto_id", p.id),
      sb.from("evidencias").select("*").eq("proyecto_id", p.id),
      sb.from("auditoria").select("*").eq("proyecto_id", p.id),
    ]);
    const evidConB64 = [];
    for(const e of (evid || [])){
      const { data: blob, error } = await sb.storage.from("evidencias").download(e.storage_path);
      evidConB64.push({...e, b64: (!error && blob) ? await blobToB64(blob) : null});
    }
    detalle.push({proyecto:p, avance: avance || [], evidencias: evidConB64, auditoria: auditoria || []});
  }
  return JSON.stringify({
    app: "plataforma-control-proyectos", formato: 2,
    exportado: new Date().toISOString(), usuario: S.sesion?.nombre,
    datos: detalle
  });
}
