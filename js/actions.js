/* =====================================================================
   ACCIONES — CRUD de proyectos, registro de ítems, evidencias, respaldo
   Los permisos reales los aplica Postgres (RLS, supabase/schema.sql);
   aquí se ocultan primero en la UI y se traduce el error si algo se
   intenta igual (por ejemplo, llamando a la función desde la consola).
   ===================================================================== */

function mensajeError(e){
  const m = e?.message || String(e);
  if(/row-level security/i.test(m)) return "No tienes permiso para hacer esto con tu cuenta.";
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
  const v = p || {nombre:"", cliente:"", tipo:TIPOS[0], comuna:"", inst:"",
                  inicio: ymd(H), termino: ymd(addD(H,10))};
  const cerrados = p ? itemsDe(p).filter(i => p.av[i.id]?.ok).length : 0;
  const puedeFechasTipo = esJefatura();   // §2: el Coordinador no edita fechas ni tipo

  abrirModal(`
    <h3>${p ? `Editar proyecto ${p.id}` : "Crear proyecto"}</h3>
    <p class="q">${p ? "Los cambios se reflejan al instante en el calendario y en el dashboard."
                     : "Se generará el checklist completo según el tipo de proyecto."}</p>
    <div class="f2">
      <div style="grid-column:1/-1"><span class="lab">Nombre del proyecto *</span>
        <input type="text" id="fNom" value="${esc(v.nombre)}" placeholder="Ej: Piscina Familia Rojas"></div>

      <div style="grid-column:1/-1"><span class="lab">Tipo de proyecto ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo
          ? `<select id="fTipo">${TIPOS.map(t => `<option${t===v.tipo?" selected":""}>${t}</option>`).join("")}</select>`
          : `<input type="text" value="${esc(v.tipo)}" disabled title="Solo Jefatura puede cambiar el tipo de proyecto">`}
      </div>
      <div><span class="lab">Fecha de inicio ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo ? `<input type="date" id="fIni" value="${v.inicio}">`
                          : `<input type="text" value="${fdate(v.inicio)}" disabled>`}</div>
      <div><span class="lab">Fecha de término ${puedeFechasTipo?'*':''}</span>
        ${puedeFechasTipo ? `<input type="date" id="fFin" value="${v.termino}">`
                          : `<input type="text" value="${fdate(v.termino)}" disabled>`}</div>

      <div><span class="lab">Cliente</span><input type="text" id="fCli" value="${esc(v.cliente==="Por definir"?"":v.cliente)}" placeholder="Opcional"></div>
      <div><span class="lab">Comuna / ubicación</span><input type="text" id="fCom" value="${esc(v.comuna==="—"?"":v.comuna)}" placeholder="Opcional"></div>
      <div style="grid-column:1/-1"><span class="lab">Instalador externo</span>
        <input type="text" id="fInst" value="${esc(v.inst==="Por asignar"?"":v.inst)}" placeholder="Opcional"></div>
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
  let ini, fin, tipo;
  if(puedeFechasTipo){
    ini = g("fIni"); fin = g("fFin"); tipo = g("fTipo");
    if(!ini || !fin) return err("Ingresa las fechas de inicio y término.");
    if(fin < ini) return err("La fecha de término no puede ser anterior a la de inicio.");
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
      if(puedeFechasTipo){ camposComunes.fecha_inicio = ini; camposComunes.fecha_termino = fin; }
      if(puedeFechasTipo && (ini !== p.inicio || fin !== p.termino)) cambios.push(`fechas ${ini} al ${fin}`);
      actualizado = await actualizarProyectoDB(id, camposComunes);

      fusionarProyecto(p, actualizado);
      await audit("proyecto_editado", cambios.join(" · ") || "datos generales", p.id);
      cerrarModal(); toast(`Proyecto ${p.id} actualizado`);
      if(puedeFechasTipo) S.mes = {y: d(p.inicio).getFullYear(), m: d(p.inicio).getMonth()};
      if(S.abierto === p.id) await Promise.all([cargarChecklist(p.id), cargarEvidencias(p.id), cargarAuditoria(p.id)]);
    }else{
      const p = await crearProyectoDB({nombre:nom, cliente:g("fCli")||"Por definir", tipo,
        comuna:g("fCom")||"—", inst:g("fInst")||"Por asignar", inicio:ini, termino:fin});
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

/* ---------- archivados ---------- */
function verArchivados(){ cerrarMenu(); S.pantalla = "archivados"; S.abierto = null; render(); window.scrollTo(0,0); }
