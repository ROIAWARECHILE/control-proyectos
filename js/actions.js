/* =====================================================================
   ACCIONES — CRUD de proyectos, registro de ítems, evidencias, respaldo
   Los permisos reales los aplica Postgres (RLS, supabase/schema.sql);
   aquí se ocultan primero en la UI y se traduce el error si algo se
   intenta igual (por ejemplo, llamando a la función desde la consola).
   ===================================================================== */

function mensajeError(e){
  const m = e?.message || String(e);
  if(/row-level security/i.test(m)) return "No tienes permiso para hacer esto con tu cuenta.";
  if(/duplicate key value/i.test(m)) return "Ya existe un registro con ese mismo valor (ej: un nombre repetido).";
  return m;
}

/* mapProyectoRow() siempre trae av/avArchivado vacíos (no son columnas de
   "proyectos"): fusionar sin excluirlos borraría el avance ya cargado. */
function fusionarProyecto(p, actualizado){
  const {av, avArchivado, ...resto} = actualizado;
  Object.assign(p, resto);
}

/* ---------- abrir detalle ---------- */
async function abrir(id, etapa){
  S.abierto = id;
  S.openSt = etapa || undefined;
  S.pantalla = null;
  try{
    await Promise.all([cargarChecklist(id), cargarEvidencias(id), cargarAuditoria(id)]);
  }catch(e){ console.error(e); toast(mensajeError(e)); }
  render(); window.scrollTo(0,0);
}

/* ---------- crear / editar proyecto ---------- */
function nuevoProyecto(){
  if(!esJefatura()) return toast("Solo Jefatura puede crear proyectos.");
  formProyecto(null);
}
function editarProyecto(id, ev){ if(ev) ev.stopPropagation(); formProyecto(id); }

function formProyecto(id){
  const p = id ? S.proyectos.find(x => x.id === id) : null;
  const H = hoy();
  const v = p || {nombre:"", cliente:"", tipo:TIPOS[0], linea:LINEAS_PISCINA[0], comuna:"", inst:"",
                  inicio: ymd(H), termino: ymd(addD(H,10))};
  const cerrados = p ? itemsDe(p).filter(i => p.av[i.id]?.ok).length : 0;
  const puedeFechasTipo = esJefatura();   // §2: el Coordinador no edita fechas ni tipo
  const coordinadores = S.usuarios.filter(u => u.rol === "coordinador");
  const coordActual = p ? p.coordinadorId : (coordinadores[0]?.id || "");

  abrirModal(`
    <h3>${p ? `Editar proyecto ${p.id}` : "Crear proyecto"}</h3>
    <p class="q">${p ? "Los cambios se reflejan al instante en el calendario y en el dashboard."
                     : "Se generará el checklist completo según el tipo de proyecto."}</p>
    <div class="f2">
      <div style="grid-column:1/-1"><span class="lab">Nombre del proyecto *</span>
        <input type="text" id="fNom" value="${esc(v.nombre)}" placeholder="Ej: Piscina Familia Rojas"></div>

      <div style="grid-column:1/-1"><span class="lab">Tipo de proyecto ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo
          ? `<select id="fTipo" onchange="document.getElementById('fLineaWrap').style.display = this.value==='Piscina' ? 'block' : 'none'">${TIPOS.map(t => `<option${t===v.tipo?" selected":""}>${t}</option>`).join("")}</select>`
          : `<input type="text" value="${esc(v.tipo)}" disabled title="Solo Jefatura puede cambiar el tipo de proyecto">`}
      </div>
      <div style="grid-column:1/-1;display:${v.tipo==='Piscina'?'block':'none'}" id="fLineaWrap">
        <span class="lab">Línea ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo
          ? `<select id="fLinea">${LINEAS_PISCINA.map(l => `<option${l===v.linea?" selected":""}>${l}</option>`).join("")}</select>`
          : `<input type="text" value="${esc(v.linea || '—')}" disabled title="Solo Jefatura puede cambiar la línea">`}
      </div>
      <div><span class="lab">Fecha de inicio ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo ? `<input type="date" id="fIni" value="${v.inicio}">`
                          : `<input type="text" value="${fdate(v.inicio)}" disabled>`}</div>
      <div><span class="lab">Fecha de término ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo ? `<input type="date" id="fFin" value="${v.termino}">`
                          : `<input type="text" value="${fdate(v.termino)}" disabled>`}</div>

      <div style="grid-column:1/-1"><span class="lab">Coordinador a cargo ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo
          ? (coordinadores.length
              ? `<select id="fCoord">${coordinadores.map(u => `<option value="${u.id}"${u.id===coordActual?" selected":""}>${esc(u.nombre)}</option>`).join("")}</select>`
              : `<input type="text" value="Aún no hay coordinadores registrados" disabled>`)
          : `<input type="text" value="${esc(p?.coord || "Sin asignar")}" disabled title="Solo Jefatura puede reasignar el coordinador">`}
      </div>

      <div><span class="lab">Cliente</span><input type="text" id="fCli" value="${esc(v.cliente==="Por definir"?"":v.cliente)}" placeholder="Opcional"></div>
      <div><span class="lab">Comuna / ubicación</span><input type="text" id="fCom" value="${esc(v.comuna==="—"?"":v.comuna)}" placeholder="Opcional"></div>
      <div style="grid-column:1/-1"><span class="lab">Instalador externo</span>
        ${INSTALADORES.length
          ? `<select id="fInst">
              <option value="">Sin asignar</option>
              ${INSTALADORES.map(ins => `<option${ins.nombre===v.inst?" selected":""}>${esc(ins.nombre)}</option>`).join("")}
              ${(v.inst && v.inst!=="Por asignar" && !INSTALADORES.some(ins=>ins.nombre===v.inst)) ? `<option selected>${esc(v.inst)}</option>` : ""}
            </select>`
          : `<input type="text" value="Aún no hay instaladores registrados (Menú → Instaladores)" disabled title="El proyecto queda sin instalador asignado hasta que agregues uno a la lista">`}
      </div>
    </div>
    ${!puedeFechasTipo ? `<div class="warnbox" style="margin:14px 0 0">Como Coordinador puedes editar nombre, cliente, comuna e instalador.
      Fechas y tipo de proyecto los cambia Jefatura (Especificación §2).</div>` : ''}
    ${p && cerrados && puedeFechasTipo ? `<div class="warnbox" style="margin:14px 0 0">Este proyecto tiene ${cerrados} ítem(s) cerrados.
      Si cambias el tipo de proyecto, el checklist se ajusta: los ítems que dejen de aplicar salen del cálculo de
      avance y quedan archivados en el historial con su evidencia (RN-12).</div>` : ''}
    <div id="fMsg" class="warnbox" style="display:none;margin:14px 0 0;background:#fde8e6;color:#8c211a"></div>
    <div class="mact">
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" id="fBtn" onclick="guardarProyecto(${p ? `'${p.id}'` : "null"})">${p ? "Guardar cambios" : "Crear proyecto"}</button></div>`);
  setTimeout(() => document.getElementById("fNom").focus(), 50);
}

async function guardarProyecto(id){
  const g = k => document.getElementById(k)?.value?.trim() ?? "";
  const err = m => { const b = document.getElementById("fMsg"); b.textContent = m; b.style.display = "block"; };
  const btn = document.getElementById("fBtn");

  const nom = g("fNom");
  if(!nom) return err("Ingresa el nombre del proyecto.");
  const puedeFechasTipo = esJefatura();
  let ini, fin, tipo, coordinadorId, linea;
  if(puedeFechasTipo){
    ini = g("fIni"); fin = g("fFin"); tipo = g("fTipo");
    if(!ini || !fin) return err("Ingresa las fechas de inicio y término.");
    if(fin < ini) return err("La fecha de término no puede ser anterior a la de inicio.");
    coordinadorId = document.getElementById("fCoord")?.value || null;
    linea = tipo === "Piscina" ? g("fLinea") : null;
    if(tipo === "Piscina" && !linea) return err("Selecciona la línea: SWIM o SMARTPOOLS.");
  }

  btn.disabled = true; btn.textContent = "Guardando…";
  try{
    if(id){
      const p = S.proyectos.find(x => x.id === id);
      const cambios = [];
      let actualizado = p;

      if(puedeFechasTipo && tipo !== p.tipo){
        cambios.push(`tipo ${p.tipo} → ${tipo}`);
        actualizado = await cambiarTipoProyectoDB(p, tipo);
      }
      const camposComunes = {nombre:nom, cliente:g("fCli")||"Por definir", comuna:g("fCom")||"—", instalador:g("fInst")||"Por asignar"};
      if(puedeFechasTipo){
        camposComunes.fecha_inicio = ini; camposComunes.fecha_termino = fin;
        camposComunes.coordinador_id = coordinadorId; camposComunes.linea_piscina = linea;
      }
      if(puedeFechasTipo && (ini !== p.inicio || fin !== p.termino)) cambios.push(`fechas ${ini} al ${fin}`);
      if(puedeFechasTipo && coordinadorId !== p.coordinadorId){
        const nuevo = S.usuarios.find(u => u.id === coordinadorId);
        cambios.push(`coordinador ${p.coord} → ${nuevo ? nuevo.nombre : "Sin asignar"}`);
      }
      if(puedeFechasTipo && linea !== p.linea) cambios.push(`línea ${p.linea || "—"} → ${linea || "—"}`);
      actualizado = await actualizarProyectoDB(id, camposComunes);

      fusionarProyecto(p, actualizado);
      await audit("proyecto_editado", cambios.join(" · ") || "datos generales", p.id);
      cerrarModal(); toast(`Proyecto ${p.id} actualizado`);
      if(puedeFechasTipo) S.mes = {y: d(p.inicio).getFullYear(), m: d(p.inicio).getMonth()};
      if(S.abierto === p.id) await Promise.all([cargarChecklist(p.id), cargarEvidencias(p.id), cargarAuditoria(p.id)]);
    }else{
      const p = await crearProyectoDB({nombre:nom, cliente:g("fCli")||"Por definir", tipo, linea,
        comuna:g("fCom")||"—", inst:g("fInst")||"Por asignar", inicio:ini, termino:fin, coordinadorId});
      S.proyectos.push(p);
      await audit("proyecto_creado", `${p.nombre} (${p.tipo}), ${itemsDe(p).length} ítems de checklist`, p.id);
      cerrarModal(); toast(`Proyecto ${p.id} creado con ${itemsDe(p).length} ítems de checklist`);
    }
    render(); window.scrollTo(0,0);
  }catch(e){
    console.error(e);
    btn.disabled = false; btn.textContent = id ? "Guardar cambios" : "Crear proyecto";
    err(mensajeError(e));
  }
}

/* ---------- eliminar (borrado lógico, RN-13) ---------- */
function confirmarEliminar(id, ev){
  if(ev) ev.stopPropagation();
  const p = S.proyectos.find(x => x.id === id);
  const cerrados = itemsDe(p).filter(i => p.av[i.id]?.ok).length;
  abrirModal(`
    <h3>Eliminar proyecto</h3>
    <p class="q">Vas a eliminar <b>${esc(p.nombre)}</b> (${p.id}).</p>
    <div class="warnbox">El proyecto tiene ${cerrados} ítem(s) cerrados. Se aplicará <b>borrado lógico</b>:
      saldrá de todas las vistas, pero sus datos, evidencias y auditoría se conservan y puede restaurarse
      desde <i>Menú ☰ → Proyectos archivados</i>.</div>
    <div id="paso1">
      <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn dg" onclick="paso2Eliminar()">Eliminar proyecto</button></div>
    </div>
    <div id="paso2" style="display:none">
      <div class="warnbox" style="background:#fdece9;color:#8c211a;border:1px solid #f3c9c6;margin-top:14px;font-weight:700">
        Última confirmación: el proyecto saldrá de la programación y del dashboard.</div>
      <div class="mact"><button class="btn g" onclick="cerrarModal()">No, cancelar</button>
      <button class="btn dr" onclick="eliminarProyecto('${p.id}')">Sí, eliminar</button></div>
    </div>`);
}
function paso2Eliminar(){
  document.getElementById("paso1").style.display = "none";
  document.getElementById("paso2").style.display = "block";
}
async function eliminarProyecto(id){
  try{
    const actualizado = await archivarProyectoDB(id, true);
    const p = S.proyectos.find(x => x.id === id);
    fusionarProyecto(p, actualizado);
    await audit("proyecto_archivado", p.nombre, p.id);
    if(S.abierto === id) S.abierto = null;
    cerrarModal(); toast(`Proyecto ${p.nombre} eliminado (recuperable en Archivados)`);
    render(); window.scrollTo(0,0);
  }catch(e){ console.error(e); cerrarModal(); toast(mensajeError(e)); }
}
async function restaurarProyecto(id){
  try{
    const actualizado = await archivarProyectoDB(id, false);
    const p = S.proyectos.find(x => x.id === id);
    fusionarProyecto(p, actualizado);
    await audit("proyecto_restaurado", p.nombre, p.id);
    toast(`Proyecto ${p.nombre} restaurado`);
    render();
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}

/* ---------- registro de ítems ---------- */
let TMP = {};

function toggle(itemId){
  if(RO()) return;
  const p = S.proyectos.find(x => x.id === S.abierto);
  const it = itemsDe(p).find(i => i.id === itemId);
  if(!it) return;

  /* reabrir: la evidencia NO se borra, queda en el historial (RN-3) */
  if(p.av[itemId]?.ok){
    abrirModal(`
      <h3>Reabrir ítem ${esc(itemId)}</h3>
      <p class="q">${esc(it.x)}</p>
      <div class="warnbox">El registro actual (sello, observación y evidencia) no se elimina:
        queda archivado en el historial del ítem y la reapertura se anota en la auditoría (RN-3).</div>
      <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" onclick="reabrirItem('${itemId}')">Reabrir ítem</button></div>`);
    return;
  }

  TMP = {itemId, blob:null};
  const etapa = p.checklist.etapas.find(e => e.items.some(i => i.id === itemId));
  const prev = p.checklist.etapas.filter(x => x.n < etapa.n).some(x => pctEtapa(p,x) < 100);
  TMP.conPrevias = prev;
  abrirModal(`
    <h3>Ítem ${esc(itemId)}</h3><p class="q">${esc(it.x)}</p>
    ${prev ? `<div class="warnbox">Hay etapas anteriores incompletas. Puedes continuar, pero quedará constancia en la auditoría (RN-4).</div>` : ''}
    <span class="lab">Evidencia (${it.ev === "obligatoria" ? "obligatoria" : "opcional"})</span>
    ${it.ev === "obligatoria" ? `<div class="warnbox" style="background:#fff4dd">Sin evidencia adjunta no se puede cerrar este ítem (RN-1).</div>` : ""}
    <div class="filebtns">
      <button onclick="document.getElementById('fileCam').click()">📷 Tomar foto</button>
      <button onclick="document.getElementById('fileGal').click()">🖼 Desde galería</button>
    </div>
    <div class="drop" id="drop">Aún no hay evidencia adjunta<br><small>Foto o pantallazo: captura del grupo de WhatsApp, foto del avance o del documento firmado</small></div>
    <span class="lab">Observación</span>
    <textarea id="nota" rows="3" placeholder="Comentario del coordinador (opcional)"></textarea>
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
    <button class="btn p" id="okBtn" ${it.ev === "obligatoria" ? "disabled" : ""} onclick="confirmarItem()">Marcar como cumplido</button></div>`);
}

/* entrada de archivo: cámara o galería */
function conectarEntradasArchivo(){
  for(const id of ["fileCam","fileGal"]){
    document.getElementById(id).onchange = async ev => {
      const f = ev.target.files[0]; ev.target.value = "";
      if(!f) return;
      if(!f.type.startsWith("image/")) return toast("El archivo debe ser una imagen.");
      try{
        TMP.blob = await comprimirImagen(f);
        const url = URL.createObjectURL(TMP.blob);
        const drop = document.getElementById("drop");
        if(drop) drop.innerHTML = `<img src="${url}" alt="Evidencia adjunta">`;
        const ok = document.getElementById("okBtn");
        if(ok) ok.disabled = false;
      }catch(e){ toast("No se pudo procesar la imagen."); }
    };
  }
}

/* reduce la imagen a un tamaño razonable antes de guardarla */
async function comprimirImagen(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const MAX = 1600;
    let w = img.naturalWidth, h = img.naturalHeight;
    if(Math.max(w,h) > MAX){ const f = MAX / Math.max(w,h); w = Math.round(w*f); h = Math.round(h*f); }
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", .82));
    return blob || file;
  }finally{ URL.revokeObjectURL(url); }
}

/* geolocalización best-effort (RN-2): nunca bloquea el registro */
function obtenerGeo(){
  return new Promise(res => {
    if(!navigator.geolocation) return res(null);
    const t = setTimeout(() => res(null), 2500);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(t); res({lat:+pos.coords.latitude.toFixed(6), lng:+pos.coords.longitude.toFixed(6)}); },
      () => { clearTimeout(t); res(null); },
      {maximumAge: 600000, timeout: 2200});
  });
}

async function confirmarItem(){
  const btn = document.getElementById("okBtn");
  btn.disabled = true; btn.textContent = "Guardando…";
  const p = S.proyectos.find(x => x.id === S.abierto);
  const nota = document.getElementById("nota").value.trim();

  try{
    const geo = await obtenerGeo();
    const ahora = new Date().toISOString();

    let evidenciaId = null;
    if(TMP.blob){
      const registro = await subirEvidenciaDB(p.id, TMP.itemId, TMP.blob);
      evidenciaId = registro.id;
      S.evCache.set(evidenciaId, {url: URL.createObjectURL(TMP.blob), meta: {ts: registro.ts, user: registro.usuario_nombre, hash: registro.hash_sha256}});
      await audit("evidencia_cargada", `Ítem ${TMP.itemId}`, p.id);
    }

    await registrarAvanceDB(p.id, TMP.itemId, {nota, evidenciaId, geo, conPrevias: TMP.conPrevias});
    p.av[TMP.itemId] = {ok:true, ts:ahora, user:S.sesion.nombre, nota, evidenciaId, geo};
    await audit("item_cerrado", `Ítem ${TMP.itemId}${TMP.conPrevias ? " · con etapas anteriores incompletas (RN-4)" : ""}${nota ? " · con observación" : ""}`, p.id);
    await cargarAuditoria(p.id);
    await notificarItemCerrado(p.id, `${S.sesion.nombre} cerró el ítem ${TMP.itemId} en ${p.nombre}`);
    TMP = {};
    cerrarModal(); toast("Ítem registrado con sello de fecha, hora y usuario"); render();
  }catch(e){
    console.error(e);
    btn.disabled = false; btn.textContent = "Marcar como cumplido";
    toast(mensajeError(e));
  }
}

async function reabrirItem(itemId){
  const p = S.proyectos.find(x => x.id === S.abierto);
  const a = p.av[itemId];
  if(!a) return cerrarModal();
  try{
    await reabrirAvanceDB(p.id, itemId, "Ítem reabierto por el coordinador");
    p.avArchivado = p.avArchivado || [];
    p.avArchivado.push({itemId, ...a, archivadoTs:new Date().toISOString(), motivo:"Ítem reabierto por el coordinador"});
    delete p.av[itemId];
    await audit("item_reabierto", `Ítem ${itemId} · el registro anterior quedó en el historial`, p.id);
    await cargarAuditoria(p.id);
    cerrarModal(); toast("Ítem reabierto. El registro anterior quedó en el historial."); render();
  }catch(e){ console.error(e); cerrarModal(); toast(mensajeError(e)); }
}

/* ---------- acta (RN-8) ---------- */
async function verActa(){
  const p = S.proyectos.find(x => x.id === S.abierto);
  if(pctTotal(p) !== 100) return;
  await audit("acta_generada", "", p.id);
  S.pantalla = "acta";
  render();
}

/* ---------- respaldo (copia manual de lo que el usuario puede ver) ---------- */
async function exportarRespaldo(){
  cerrarMenu();
  toast("Preparando copia…");
  try{
    const json = await exportarDatos();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], {type:"application/json"}));
    a.download = `respaldo-control-proyectos-${ymd(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    await audit("respaldo_exportado", "");
    toast("Copia descargada.");
  }catch(e){ console.error(e); toast("No se pudo generar la copia: " + mensajeError(e)); }
}

/* ---------- centro de notificaciones ---------- */
function toggleNotificaciones(ev){
  if(ev) ev.stopPropagation();
  cerrarMenu();
  S.notiAbierta = !S.notiAbierta;
  if(S.notiAbierta) refrescarNotificaciones(); else render();
}
function cerrarNotificaciones(){
  if(!S.notiAbierta) return;
  S.notiAbierta = false; render();
}
async function refrescarNotificaciones(){
  try{ await cargarNotificaciones(); }catch(e){ console.error(e); }
  render();
}
async function abrirNotificacion(id, proyectoId){
  cerrarNotificaciones();
  try{
    await marcarNotificacionLeidaDB(id);
    const n = S.notificaciones.find(x => x.id === id);
    if(n) n.leida = true;
  }catch(e){ console.error(e); }
  if(proyectoId) abrir(proyectoId); else render();
}
async function marcarTodasNotificacionesLeidas(){
  try{
    await marcarTodasNotificacionesLeidasDB();
    S.notificaciones.forEach(n => n.leida = true);
    render();
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}

/* ---------- archivados ---------- */
function verArchivados(){ cerrarMenu(); S.pantalla = "archivados"; S.abierto = null; render(); window.scrollTo(0,0); }

/* ---------- usuarios (Jefatura) ---------- */
function verUsuarios(){
  if(!esJefatura()) return toast("Solo Jefatura puede administrar usuarios.");
  cerrarMenu(); S.pantalla = "usuarios"; S.abierto = null; render(); window.scrollTo(0,0);
}

function cambiarRolUsuario(usuarioId, nuevoRol){
  const u = S.usuarios.find(x => x.id === usuarioId);
  if(!u) return;
  if(usuarioId === S.sesion.userId && nuevoRol !== "jefatura"){
    abrirModal(`
      <h3>Quitarte el rol de Jefatura</h3>
      <div class="warnbox" style="background:#fdece9;color:#8c211a;border:1px solid #f3c9c6;font-weight:700">
        Vas a pasar tu propia cuenta a Coordinador. Perderás esta pantalla y la vista de supervisión de inmediato.</div>
      <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn dr" onclick="cerrarModal();ejecutarCambioRol('${usuarioId}','${nuevoRol}')">Sí, quitarme Jefatura</button></div>`);
    return;
  }
  ejecutarCambioRol(usuarioId, nuevoRol);
}

async function ejecutarCambioRol(usuarioId, nuevoRol){
  const u = S.usuarios.find(x => x.id === usuarioId);
  if(!u) return;
  try{
    await asignarRolDB(usuarioId, nuevoRol);
    u.rol = nuevoRol;
    await audit("rol_cambiado", `${u.nombre}: ahora ${nuevoRol}`);
    toast(`${u.nombre} ahora es ${nuevoRol === "jefatura" ? "Jefatura" : "Coordinador"}.`);
    if(usuarioId === S.sesion.userId){ S.sesion.rol = nuevoRol; S.panel = "proyectos"; S.pantalla = null; }
    render();
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}

/* ---------- catálogo de ítems (Jefatura) ---------- */
function verCatalogo(){
  if(!esJefatura()) return toast("Solo Jefatura puede editar el catálogo.");
  cerrarMenu(); S.pantalla = "catalogo"; S.abierto = null; render(); window.scrollTo(0,0);
}

function formEtapaCatalogo(n){
  const e = ETAPAS.find(x => x.n === n);
  abrirModal(`
    <h3>Editar etapa ${n}</h3>
    <p class="q">El número y la fórmula de fecha límite de la etapa no se pueden cambiar (RN-5); solo su nombre y su hito.</p>
    <div class="fgrp"><span class="lab">Nombre de la etapa</span><input type="text" id="ecNom" value="${esc(e.t)}"></div>
    <div class="fgrp"><span class="lab">Hito</span><input type="text" id="ecHito" value="${esc(e.hito)}"></div>
    <div id="ecMsg" class="warnbox" style="display:none;background:#fde8e6;color:#8c211a"></div>
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
    <button class="btn p" onclick="guardarEtapaCatalogo(${n})">Guardar</button></div>`);
}
async function guardarEtapaCatalogo(n){
  const nom = document.getElementById("ecNom").value.trim();
  const hito = document.getElementById("ecHito").value.trim();
  const err = m => { const b = document.getElementById("ecMsg"); b.textContent = m; b.style.display = "block"; };
  if(!nom || !hito) return err("Completa ambos campos.");
  try{
    await actualizarEtapaCatalogoDB(n, {nombre: nom, hito});
    const e = ETAPAS.find(x => x.n === n); e.t = nom; e.hito = hito;
    await audit("catalogo_etapa_editada", `Etapa ${n}: ${nom}`);
    cerrarModal(); toast(`Etapa ${n} actualizada`); render();
  }catch(e2){ console.error(e2); err(mensajeError(e2)); }
}

function formItemCatalogo(id, etapaN){
  const e = ETAPAS.find(x => x.n === etapaN);
  const it = id ? e.items.find(i => i.id === id) : null;
  const v = it || {id:"", x:"", ev:"opcional", ap:"*"};
  const marcado = tipo => v.ap === "*" ? true : v.ap.includes(tipo);
  abrirModal(`
    <h3>${it ? `Editar ítem ${esc(id)}` : `Nuevo ítem · etapa ${etapaN}`}</h3>
    ${it ? "" : `<div class="fgrp"><span class="lab">Identificador único</span>
      <input type="text" id="icId" placeholder="${etapaN}.${e.items.length+1}"></div>`}
    <div class="fgrp"><span class="lab">Texto del ítem</span><textarea id="icTexto" rows="2">${esc(v.x)}</textarea></div>
    <div class="f2">
      <div class="fgrp"><span class="lab">Evidencia</span>
        <select id="icEv"><option value="obligatoria"${v.ev==='obligatoria'?' selected':''}>Obligatoria</option>
        <option value="opcional"${v.ev==='opcional'?' selected':''}>Opcional</option></select></div>
      <div class="fgrp"><span class="lab">Aplica a</span>
        <select id="icAplica" onchange="document.getElementById('icTiposBox').style.display=this.value==='todos'?'none':'block'">
          <option value="todos"${v.ap==='*'?' selected':''}>Todos los tipos</option>
          <option value="algunos"${v.ap!=='*'?' selected':''}>Solo algunos tipos</option></select></div>
    </div>
    <div id="icTiposBox" style="display:${v.ap==='*'?'none':'block'};margin-bottom:14px">
      ${TIPOS.map(t => `<label style="font-size:13px;display:inline-block;width:48%">
        <input type="checkbox" class="icTipo" value="${esc(t)}" ${marcado(t)?'checked':''}> ${esc(t)}</label>`).join("")}
    </div>
    <div id="icMsg" class="warnbox" style="display:none;background:#fde8e6;color:#8c211a"></div>
    <div class="mact">
      ${it ? `<button class="btn dg" onclick="archivarItemCatalogo('${id}')" style="margin-right:auto">Quitar del catálogo</button>` : ""}
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" onclick="guardarItemCatalogo(${it?`'${id}'`:"null"},${etapaN})">${it?"Guardar cambios":"Crear ítem"}</button></div>`);
}

async function guardarItemCatalogo(id, etapaN){
  const texto = document.getElementById("icTexto").value.trim();
  const ev = document.getElementById("icEv").value;
  const aplicaTodos = document.getElementById("icAplica").value === "todos";
  const tipos = [...document.querySelectorAll(".icTipo:checked")].map(c => c.value);
  const err = m => { const b = document.getElementById("icMsg"); b.textContent = m; b.style.display = "block"; };
  if(!texto) return err("Ingresa el texto del ítem.");
  if(!aplicaTodos && !tipos.length) return err("Selecciona al menos un tipo de proyecto.");

  try{
    const e = ETAPAS.find(x => x.n === etapaN);
    if(id){
      await actualizarItemCatalogoDB(id, {texto, evidencia: ev, aplica_tipos: aplicaTodos ? [] : tipos});
      Object.assign(e.items.find(i => i.id === id), {x: texto, ev, ap: aplicaTodos ? "*" : tipos});
      await audit("catalogo_item_editado", id);
      cerrarModal(); toast(`Ítem ${id} actualizado`); render();
    }else{
      const nid = document.getElementById("icId").value.trim();
      if(!nid) return err("Ingresa un identificador para el ítem.");
      if(ETAPAS.some(x => x.items.some(i => i.id === nid))) return err("Ese identificador ya existe.");
      await crearItemCatalogoDB({id: nid, etapaN, texto, evidencia: ev, aplicaTipos: aplicaTodos ? [] : tipos, orden: e.items.length + 1});
      e.items.push({id: nid, x: texto, ev, ap: aplicaTodos ? "*" : tipos});
      await audit("catalogo_item_creado", nid);
      cerrarModal(); toast(`Ítem ${nid} creado`); render();
    }
  }catch(e2){ console.error(e2); err(mensajeError(e2)); }
}

function archivarItemCatalogo(id){
  abrirModal(`
    <h3>Quitar ítem ${esc(id)} del catálogo</h3>
    <p class="q">Ya no aparecerá en proyectos nuevos ni al cambiar el tipo de un proyecto existente. Los proyectos
    que ya tienen este ítem en su checklist no se ven afectados: conservan su propia copia.</p>
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
    <button class="btn dr" onclick="confirmarArchivarItemCatalogo('${id}')">Quitar del catálogo</button></div>`);
}
async function confirmarArchivarItemCatalogo(id){
  try{
    await archivarItemCatalogoDB(id, false);
    for(const e of ETAPAS){ const i = e.items.findIndex(x => x.id === id); if(i >= 0) e.items.splice(i,1); }
    await audit("catalogo_item_archivado", id);
    cerrarModal(); toast(`Ítem ${id} quitado del catálogo`); render();
  }catch(e){ console.error(e); cerrarModal(); toast(mensajeError(e)); }
}

async function verItemsArchivadosCatalogo(){
  try{
    const items = await cargarItemsArchivadosCatalogoDB();
    abrirModal(`
      <h3>Ítems archivados del catálogo</h3>
      ${items.length ? items.map(i => `
        <div class="alrow" style="cursor:default">
          <div style="flex:1"><b>${esc(i.id)}</b> · Etapa ${i.etapa_n}<br><small>${esc(i.texto)}</small></div>
          <button class="evbtn" onclick="restaurarItemCatalogo('${i.id}')">Restaurar</button>
        </div>`).join("") : `<p class="q">No hay ítems archivados.</p>`}
      <div class="mact"><button class="btn g" onclick="cerrarModal()">Cerrar</button></div>`, true);
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}
async function restaurarItemCatalogo(id){
  try{
    await archivarItemCatalogoDB(id, true);
    await cargarCatalogo();   // re-trae todo el catálogo: más simple y robusto que reinsertar a mano en orden
    await audit("catalogo_item_restaurado", id);
    cerrarModal(); toast(`Ítem ${id} restaurado`); render();
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}

/* ---------- instaladores (Jefatura) ---------- */
function verInstaladores(){
  if(!esJefatura()) return toast("Solo Jefatura puede editar la lista de instaladores.");
  cerrarMenu(); S.pantalla = "instaladores"; S.abierto = null; render(); window.scrollTo(0,0);
}

function formInstalador(id){
  const it = id ? INSTALADORES.find(i => i.id === id) : null;
  abrirModal(`
    <h3>${it ? `Editar instalador` : "Agregar instalador"}</h3>
    <div class="fgrp"><span class="lab">Nombre</span>
      <input type="text" id="inNom" value="${esc(it ? it.nombre : "")}" placeholder="Ej: Carlos Alcántara"></div>
    <div id="inMsg" class="warnbox" style="display:none;background:#fde8e6;color:#8c211a"></div>
    <div class="mact">
      ${it ? `<button class="btn dg" onclick="archivarInstalador('${id}')" style="margin-right:auto">Quitar de la lista</button>` : ""}
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" onclick="guardarInstalador(${it?`'${id}'`:"null"})">${it?"Guardar cambios":"Agregar"}</button></div>`);
  setTimeout(() => document.getElementById("inNom")?.focus(), 50);
}

async function guardarInstalador(id){
  const nombre = document.getElementById("inNom").value.trim();
  const err = m => { const b = document.getElementById("inMsg"); b.textContent = m; b.style.display = "block"; };
  if(!nombre) return err("Ingresa el nombre del instalador.");
  try{
    if(id){
      await actualizarInstaladorDB(id, {nombre});
      Object.assign(INSTALADORES.find(i => i.id === id), {nombre});
      await audit("instalador_editado", nombre);
      cerrarModal(); toast("Instalador actualizado"); render();
    }else{
      const creado = await crearInstaladorDB(nombre);
      INSTALADORES.push(creado);
      await audit("instalador_creado", nombre);
      cerrarModal(); toast(`${nombre} agregado a la lista`); render();
    }
  }catch(e){ console.error(e); err(mensajeError(e)); }
}

function archivarInstalador(id){
  const it = INSTALADORES.find(i => i.id === id);
  abrirModal(`
    <h3>Quitar a ${esc(it.nombre)} de la lista</h3>
    <p class="q">Ya no aparecerá como opción al crear o editar proyectos. Los proyectos que ya lo tienen asignado
    no se ven afectados.</p>
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
    <button class="btn dr" onclick="confirmarArchivarInstalador('${id}')">Quitar de la lista</button></div>`);
}
async function confirmarArchivarInstalador(id){
  const it = INSTALADORES.find(i => i.id === id);
  try{
    await archivarInstaladorDB(id, false);
    INSTALADORES = INSTALADORES.filter(i => i.id !== id);
    await audit("instalador_archivado", it?.nombre || id);
    cerrarModal(); toast(`${it?.nombre || "Instalador"} quitado de la lista`); render();
  }catch(e){ console.error(e); cerrarModal(); toast(mensajeError(e)); }
}

async function verInstaladoresArchivados(){
  try{
    const lista = await cargarInstaladoresArchivadosDB();
    abrirModal(`
      <h3>Instaladores archivados</h3>
      ${lista.length ? lista.map(i => `
        <div class="alrow" style="cursor:default">
          <div style="flex:1"><b>${esc(i.nombre)}</b></div>
          <button class="evbtn" onclick="restaurarInstalador('${i.id}')">Restaurar</button>
        </div>`).join("") : `<p class="q">No hay instaladores archivados.</p>`}
      <div class="mact"><button class="btn g" onclick="cerrarModal()">Cerrar</button></div>`, true);
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}
async function restaurarInstalador(id){
  try{
    await archivarInstaladorDB(id, true);
    await cargarInstaladores();
    await audit("instalador_restaurado", id);
    cerrarModal(); toast("Instalador restaurado"); render();
  }catch(e){ console.error(e); toast(mensajeError(e)); }
}

function abrirInvitarUsuario(){
  if(!esJefatura()) return toast("Solo Jefatura puede invitar usuarios.");
  abrirModal(`
    <h3>Invitar usuario</h3>
    <p class="q">Le llega un correo con un enlace para definir su contraseña; al entrar por primera vez ya queda
    con el rol que elijas acá — no necesita pasar por "Crear cuenta" ni que nadie la ascienda después.</p>
    <div class="fgrp"><span class="lab">Nombre</span><input type="text" id="ivNom" placeholder="Ej: Yerko Ardiles"></div>
    <div class="fgrp"><span class="lab">Correo</span><input type="text" id="ivEmail" placeholder="correo@empresa.cl"></div>
    <div class="fgrp"><span class="lab">Rol</span>
      <select id="ivRol"><option value="coordinador">Coordinador</option><option value="jefatura">Jefatura</option></select></div>
    <div id="ivMsg" class="warnbox" style="display:none;background:#fde8e6;color:#8c211a"></div>
    <div class="mact">
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" id="ivBtn" onclick="invitarUsuario()">Enviar invitación</button></div>`);
  setTimeout(() => document.getElementById("ivNom")?.focus(), 60);
}

async function invitarUsuario(){
  const nombre = document.getElementById("ivNom").value.trim();
  const email = document.getElementById("ivEmail").value.trim();
  const rol = document.getElementById("ivRol").value;
  const err = m => { const b = document.getElementById("ivMsg"); b.textContent = m; b.style.display = "block"; };
  if(!nombre || !email) return err("Completa el nombre y el correo.");

  const btn = document.getElementById("ivBtn");
  btn.disabled = true; btn.textContent = "Enviando…";
  try{
    await invitarUsuarioDB(email, nombre, rol);
    try{ await cargarUsuarios(); }catch(e){ console.error(e); }
    await audit("usuario_invitado", `${nombre} (${email}) como ${rol === "jefatura" ? "Jefatura" : "Coordinador"}`);
    cerrarModal(); toast(`Invitación enviada a ${email}`); render();
  }catch(e){
    console.error(e);
    btn.disabled = false; btn.textContent = "Enviar invitación";
    err(mensajeError(e));
  }
}
