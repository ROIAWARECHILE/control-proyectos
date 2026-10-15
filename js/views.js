/* =====================================================================
   VISTAS — todo el render de la interfaz
   ===================================================================== */

const app = document.getElementById("app");

/* ---------- helpers de UI ---------- */
function toast(m){
  const t = document.getElementById("toast");
  t.textContent = m; t.classList.add("on");
  clearTimeout(t._x); t._x = setTimeout(() => t.classList.remove("on"), 2600);
}
function abrirModal(html, ancho){
  const M = document.getElementById("modal");
  M.className = "modal" + (ancho ? " ancho" : "");
  M.innerHTML = html;
  document.getElementById("ov").classList.add("on");
}
function cerrarModal(){ document.getElementById("ov").classList.remove("on"); }
function cerrarMenu(){ document.getElementById("menu")?.classList.remove("on"); }
function toggleMenu(ev){ ev.stopPropagation(); cerrarNotificaciones(); document.getElementById("menu").classList.toggle("on"); }

const esJefatura = () => S.sesion?.rol === "jefatura";
const RO = esJefatura;   // checklist de solo lectura para Jefatura

/* ---------- topbar ---------- */
/* alertas de etapas (recalculadas, todo proyecto activo visible) + notificaciones no leídas (eventos) */
function totalNotificaciones(){
  return alertas(activos()).length + S.notificacionesNoLeidas;
}

function panelNotificaciones(){
  const al = alertas(activos());
  const sinLeer = S.notificacionesNoLeidas;
  const vacio = !al.length && !S.notificaciones.length;
  return `
  <div class="menu notipanel ${S.notiAbierta?'on':''}" id="notipanel">
    <div class="notihd"><b>Notificaciones</b>
      ${sinLeer ? `<button class="linkbtn" onclick="marcarTodasNotificacionesLeidas()">Marcar todo leído</button>` : ""}
    </div>
    ${vacio ? `<div class="notiempty">Sin novedades por ahora.</div>` : `
      ${al.length ? `<div class="notigrp">Alertas de etapas</div>
        ${al.slice(0,8).map(a => `
          <button class="notirow" onclick="cerrarNotificaciones();abrir('${a.p.id}',${a.e.n})">
            <span class="ic ic-${a.sev}">!</span>
            <span><b>${esc(a.p.nombre)}</b> — ${esc(a.txt)}</span>
          </button>`).join("")}` : ""}
      ${S.notificaciones.length ? `<div class="notigrp">Actividad</div>
        ${S.notificaciones.slice(0,15).map(n => `
          <button class="notirow ${n.leida?'':'sinleer'}" onclick="abrirNotificacion(${n.id},'${n.proyecto_id||''}')">
            <span>${esc(n.mensaje)}</span><small>${fts(n.created_at)}</small>
          </button>`).join("")}` : ""}
    `}
  </div>`;
}

function renderTopbar(){
  const T = document.getElementById("topbar");
  if(!S.sesion){
    T.innerHTML = `<div class="logo"><span>◈</span> Control de Proyectos</div><div class="sp"></div>`;
    return;
  }
  const sw = esJefatura() ? "" : `
    <div class="roleSw">
      <button class="${S.panel==='proyectos'?'on':''}" onclick="cambiarPanel('proyectos')">Mis proyectos</button>
      <button class="${S.panel==='dashboard'?'on':''}" onclick="cambiarPanel('dashboard')">Dashboard</button>
    </div>`;
  const totalNoti = totalNotificaciones();
  T.innerHTML = `
    <div class="logo"><span>◈</span> Control de Proyectos</div>
    <div class="sp"></div>
    ${sw}
    <div class="who"><b>${esc(S.sesion.nombre)}</b><span>${esJefatura() ? "Jefatura · supervisión" : "Coordinador de Proyectos"}</span></div>
    <button class="menuBtn" title="Notificaciones" onclick="toggleNotificaciones(event)" style="position:relative">
      🔔${totalNoti ? `<span class="notidot">${totalNoti>9?'9+':totalNoti}</span>` : ""}
    </button>
    ${panelNotificaciones()}
    <button class="menuBtn" title="Menú" onclick="toggleMenu(event)">☰</button>
    <div class="menu" id="menu">
      <button onclick="verArchivados()">Proyectos archivados<small>Eliminados de forma lógica, recuperables</small></button>
      ${esJefatura() ? `<button onclick="verUsuarios()">Usuarios<small>Ver cuentas y asignar roles</small></button>` : ""}
      ${esJefatura() ? `<button onclick="verCatalogo()">Catálogo de ítems<small>Editar el checklist de los proyectos nuevos</small></button>` : ""}
      ${esJefatura() ? `<button onclick="verInstaladores()">Instaladores<small>Lista de instaladores externos</small></button>` : ""}
      <div class="sep"></div>
      <button onclick="exportarRespaldo()">Exportar copia<small>Descarga en JSON lo que puedes ver</small></button>
      <div class="sep"></div>
      <button onclick="abrirCambiarContrasena()">Cambiar contraseña<small>Define una nueva contraseña para tu cuenta</small></button>
      <button onclick="salir()">Cerrar sesión</button>
    </div>`;
}
function cambiarPanel(p){ S.panel = p; S.abierto = null; S.pantalla = null; render(); window.scrollTo(0,0); }

/* ---------- despachador ---------- */
function render(){
  renderTopbar();
  if(S.recuperando)               return vistaRecuperar();
  if(S.hayCuentas === null)       return;   // aún resolviendo el estado inicial
  if(!S.hayCuentas)                return vistaSetup();
  if(!S.sesion)                   return vistaLogin();
  if(S.pantalla === "archivados") return vistaArchivados();
  if(S.pantalla === "usuarios")   return vistaUsuarios();
  if(S.pantalla === "catalogo")   return vistaCatalogo();
  if(S.pantalla === "instaladores") return vistaInstaladores();
  if(S.pantalla === "acta")       return vistaActa();
  if(S.abierto)                   return vistaDetalle();
  if(esJefatura() || S.panel === "dashboard") return vistaJefatura();
  return vistaCoordinador();
}

/* ---------- primera vez ---------- */
function vistaSetup(){
  app.innerHTML = `
  <div class="auth"><div class="card" style="padding:26px">
    <div class="authlogo">◈</div>
    <h2 style="text-align:center">Configuración inicial</h2>
    <p class="sub" style="text-align:center">Crea la primera cuenta de Coordinador y la primera de Jefatura. Después, Jefatura puede invitar a más usuarios desde Menú → Usuarios.</p>
    <div class="fgrp"><span class="lab">Nombre del Coordinador de Proyectos</span>
      <input type="text" id="suNomC" placeholder="Ej: Juan Pérez"></div>
    <div class="fgrp"><span class="lab">Correo del Coordinador</span>
      <input type="text" id="suEmailC" placeholder="coordinador@tuempresa.cl"></div>
    <div class="f2">
      <div class="fgrp"><span class="lab">Contraseña (mín. 6 caracteres)</span>
        <input type="password" id="suPassC" autocomplete="new-password"></div>
      <div class="fgrp"><span class="lab">Repetir contraseña</span>
        <input type="password" id="suPassC2" autocomplete="new-password"></div>
    </div>
    <div style="border-top:1px solid var(--line);margin:16px 0"></div>
    <div class="fgrp"><span class="lab">Nombre de la Jefatura</span>
      <input type="text" id="suNomJ" placeholder="Ej: Jefatura de Operaciones"></div>
    <div class="fgrp"><span class="lab">Correo de Jefatura</span>
      <input type="text" id="suEmailJ" placeholder="jefatura@tuempresa.cl"></div>
    <div class="f2">
      <div class="fgrp"><span class="lab">Contraseña (mín. 6 caracteres)</span>
        <input type="password" id="suPassJ" autocomplete="new-password"></div>
      <div class="fgrp"><span class="lab">Repetir contraseña</span>
        <input type="password" id="suPassJ2" autocomplete="new-password"></div>
    </div>
    <div id="authMsg" class="authmsg"></div>
    <button class="btn p" id="suBtn" style="width:100%;padding:12px" onclick="crearCuentas()">Crear cuentas y comenzar</button>
    <p class="sub" style="margin:14px 0 0;font-size:12px;text-align:center">Si el proyecto exige confirmar el correo,
    cada cuenta deberá abrir el enlace que reciba antes de su primer ingreso.</p>
  </div></div>`;
  setTimeout(() => document.getElementById("suNomC")?.focus(), 60);
}

/* ---------- ingreso ---------- */
function vistaLogin(){
  app.innerHTML = `
  <div class="auth"><div class="card" style="padding:26px">
    <div class="authlogo">◈</div>
    <h2 style="text-align:center">Control de Proyectos</h2>
    <p class="sub" style="text-align:center">Ingresa con tu cuenta</p>
    <div class="fgrp"><span class="lab">Correo</span>
      <input type="text" id="liEmail" autocomplete="username" placeholder="tu@correo.cl"></div>
    <div class="fgrp"><span class="lab">Contraseña</span>
      <input type="password" id="liPass" autocomplete="current-password"
             onkeydown="if(event.key==='Enter')ingresar()"></div>
    <div id="authMsg" class="authmsg"></div>
    <button class="btn p" id="liBtn" style="width:100%;padding:12px" onclick="ingresar()">Ingresar</button>
    <p style="text-align:center;margin:14px 0 0"><button class="linkbtn" onclick="olvideContrasena()">¿Olvidaste tu contraseña?</button></p>
    <p style="text-align:center;margin:8px 0 0"><button class="linkbtn" onclick="abrirCrearCuenta()">¿Nuevo aquí? Crear cuenta</button></p>
    ${S.hayJefatura === false ? `
    <div class="warnbox" style="margin-top:16px;text-align:center">Todavía no hay ninguna cuenta Jefatura activa
      (¿se interrumpió la configuración inicial?).<br>
      <button class="linkbtn" onclick="abrirCrearJefatura()">Crear la primera cuenta Jefatura</button></div>` : ''}
  </div></div>`;
  setTimeout(() => document.getElementById("liEmail")?.focus(), 60);
}

/* ---------- crear cuenta propia (tras el arranque inicial) ---------- */
function abrirCrearCuenta(){
  abrirModal(`
    <h3>Crear cuenta</h3>
    <p class="q">Quedas como Coordinador de Proyectos. Si corresponde, una Jefatura ya activa puede subirte
    el rol desde Menú → Usuarios una vez que ingreses.</p>
    <div class="fgrp"><span class="lab">Tu nombre</span><input type="text" id="ccNom" placeholder="Ej: Yerko Ardiles"></div>
    <div class="fgrp"><span class="lab">Tu correo</span><input type="text" id="ccEmail" placeholder="tu@correo.cl"></div>
    <div class="f2">
      <div class="fgrp"><span class="lab">Contraseña (mín. 6 caracteres)</span><input type="password" id="ccPass" autocomplete="new-password"></div>
      <div class="fgrp"><span class="lab">Repetir contraseña</span><input type="password" id="ccPass2" autocomplete="new-password"></div>
    </div>
    <div id="ccMsg" class="authmsg"></div>
    <div class="mact">
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" id="ccBtn" onclick="crearCuentaPropia()">Crear cuenta</button></div>`);
  setTimeout(() => document.getElementById("ccNom")?.focus(), 60);
}

/* ---------- crear la primera cuenta Jefatura (recuperación de arranque) ----------
   Solo se ofrece cuando S.hayJefatura === false (ver vistaLogin). En cuanto
   se crea una, este camino se cierra: nuevas Jefaturas se agregan luego
   desde Menú → Usuarios (asignar_rol), nunca por autorregistro. */
function abrirCrearJefatura(){
  abrirModal(`
    <h3>Crear la primera cuenta Jefatura</h3>
    <p class="q">Esta opción solo aparece porque todavía no existe ninguna cuenta Jefatura — probablemente la
    configuración inicial se interrumpió antes de crearla. En cuanto la crees, esta opción desaparece.</p>
    <div class="fgrp"><span class="lab">Nombre</span><input type="text" id="cjNom" placeholder="Ej: Yerko Ardiles"></div>
    <div class="fgrp"><span class="lab">Correo</span><input type="text" id="cjEmail" placeholder="tu@correo.cl"></div>
    <div class="f2">
      <div class="fgrp"><span class="lab">Contraseña (mín. 6 caracteres)</span><input type="password" id="cjPass" autocomplete="new-password"></div>
      <div class="fgrp"><span class="lab">Repetir contraseña</span><input type="password" id="cjPass2" autocomplete="new-password"></div>
    </div>
    <div id="cjMsg" class="authmsg"></div>
    <div class="mact">
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" id="cjBtn" onclick="crearCuentaJefatura()">Crear cuenta Jefatura</button></div>`);
  setTimeout(() => document.getElementById("cjNom")?.focus(), 60);
}

/* ---------- pantalla que llega desde el enlace de recuperación ---------- */
function vistaRecuperar(){
  app.innerHTML = `
  <div class="auth"><div class="card" style="padding:26px">
    <div class="authlogo">◈</div>
    <h2 style="text-align:center">Nueva contraseña</h2>
    <p class="sub" style="text-align:center">Define una nueva contraseña para tu cuenta</p>
    <div class="fgrp"><span class="lab">Nueva contraseña (mín. 6 caracteres)</span>
      <input type="password" id="rcPass" autocomplete="new-password"></div>
    <div class="fgrp"><span class="lab">Repetir contraseña</span>
      <input type="password" id="rcPass2" autocomplete="new-password"></div>
    <div id="authMsg" class="authmsg"></div>
    <button class="btn p" style="width:100%;padding:12px" onclick="confirmarNuevaContrasena()">Guardar contraseña</button>
  </div></div>`;
}

/* ---------- cambiar contraseña estando ya logueado (no requiere correo) ---------- */
function abrirCambiarContrasena(){
  cerrarMenu();
  abrirModal(`
    <h3>Cambiar contraseña</h3>
    <p class="q">Define una nueva contraseña para tu cuenta (${esc(S.sesion.nombre)}).</p>
    <div class="fgrp"><span class="lab">Nueva contraseña (mín. 6 caracteres)</span>
      <input type="password" id="cpPass1" autocomplete="new-password"></div>
    <div class="fgrp"><span class="lab">Repetir contraseña</span>
      <input type="password" id="cpPass2" autocomplete="new-password"></div>
    <div id="cpMsg" class="authmsg"></div>
    <div class="mact">
      <button class="btn g" onclick="cerrarModal()">Cancelar</button>
      <button class="btn p" id="cpBtn" onclick="guardarCambioContrasena()">Guardar</button></div>`);
  setTimeout(() => document.getElementById("cpPass1")?.focus(), 60);
}

/* ---------- barra de mes compartida ---------- */
function barraMes(extra){
  return `
  <div class="calbar">
    <div class="nav">
      <button onclick="mover(-1)" title="Mes anterior">‹</button>
      <span class="mlab">${MESES[S.mes.m]} ${S.mes.y}</span>
      <button onclick="mover(1)" title="Mes siguiente">›</button>
    </div>
    <button class="chip" onclick="hoyMes()">Hoy</button>
    ${extra || ""}
  </div>`;
}
function mover(n){ const x = new Date(S.mes.y, S.mes.m + n, 1); S.mes = {y:x.getFullYear(), m:x.getMonth()}; render(); }
function hoyMes(){ const H = hoy(); S.mes = {y:H.getFullYear(), m:H.getMonth()}; render(); }

/* ---------- selector En trabajo / Completados (coordinador y dashboard) ---------- */
function filtroTrabajo(){
  const nT = enTrabajo().length, nC = completados().length;
  return `<div class="vsw filtro">
    <button class="${S.filtro==='trabajo'?'on':''}" onclick="cambiarFiltro('trabajo')">En trabajo <span class="n">${nT}</span></button>
    <button class="${S.filtro==='completados'?'on':''}" onclick="cambiarFiltro('completados')">Completados <span class="n">${nC}</span></button>
  </div>`;
}
function cambiarFiltro(f){ S.filtro = f; render(); window.scrollTo(0,0); }

/* ---------- COORDINADOR: programación ---------- */
function vistaCoordinador(){
  if(!activos().length){
    app.innerHTML = `
    <div class="ph"><div><h1>Mis proyectos</h1>
      <p class="sub" style="margin:0">Programación mensual del coordinador</p></div>
      <button class="btn p" onclick="nuevoProyecto()">+ Crear proyecto</button></div>
    <div class="card hero">
      <div class="big">📋</div>
      <h2>Aún no tienes proyectos</h2>
      <p>Crea tu primer proyecto o espera a que Jefatura te asigne uno; en cuanto exista aparecerá aquí.</p>
    </div>`;
    return;
  }
  if(S.filtro === "completados"){
    const lista = completados();
    app.innerHTML = `
    <div class="ph"><div>
      <h1>Mis proyectos</h1>
      <p class="sub" style="margin:0">Proyectos con el checklist al 100% y el acta de recepción generada.</p>
    </div><button class="btn p" onclick="nuevoProyecto()">+ Crear proyecto</button></div>
    <div class="calbar">${filtroTrabajo()}</div>
    ${lista.length ? `<div class="pgrid">${lista.map(p => fichaProyecto(p)).join("")}</div>`
      : `<div class="card empty">Aún no hay proyectos completados. Un proyecto queda completado al generar su acta de recepción con el checklist al 100%.</div>`}`;
    return;
  }
  const lista = proyectosDelMes();
  const c = k => lista.filter(p => estado(p).k === k).length;
  const resumen = lista.length
    ? `<span class="cnt"><b>${lista.length}</b> proyecto${lista.length===1?'':'s'} en ${MESES[S.mes.m]}</span>
       ${c("bad") ?`<span class="pill b"><span class="dot s-bad"></span>${c("bad")} atrasado${c("bad")>1?'s':''}</span>`:''}
       ${c("warn")?`<span class="pill"><span class="dot s-warn"></span>${c("warn")} en curso</span>`:''}
       ${c("idle")?`<span class="pill"><span class="dot s-idle"></span>${c("idle")} por iniciar</span>`:''}
       ${c("ready")?`<span class="pill r"><span class="dot s-ready"></span>${c("ready")} listo${c("ready")>1?'s':''} para acta</span>`:''}`
    : `<span class="cnt vacio">Sin proyectos en ${MESES[S.mes.m]} ${S.mes.y}</span>`;
  app.innerHTML = `
  <div class="ph"><div>
    <h1>Mis proyectos</h1>
    <p class="sub" style="margin:0">Programación mensual del coordinador · hasta ${MAXLANE} proyectos simultáneos por día.</p>
  </div><button class="btn p" onclick="nuevoProyecto()">+ Crear proyecto</button></div>
  <div class="calbar">${filtroTrabajo()}</div>
  ${barraMes(`
    <div class="resumen">${resumen}</div>
    <div style="flex:1"></div>
    <div class="vsw">
      <button class="${S.vista==='sem'?'on':''}" onclick="S.vista='sem';render()">Por semana</button>
      <button class="${S.vista==='cal'?'on':''}" onclick="S.vista='cal';render()">Calendario</button>
      <button class="${S.vista==='list'?'on':''}" onclick="S.vista='list';render()">Todas</button>
    </div>`)}
  ${S.vista === "cal" ? calendario() : S.vista === "list" ? tarjetas() : semanal()}`;
}

function semanal(){
  const wks = semanasDe(S.mes.y, S.mes.m), hy = ymd(hoy());
  const mm = dt => dt.toLocaleDateString("es-CL",{day:"numeric",month:"short"});
  return wks.map((wk,wi) => {
    const a = ymd(wk[0]), b = ymd(wk[6]);
    const lista = visibles().filter(p => p.inicio <= b && p.termino >= a)
                           .sort((x,y) => x.inicio.localeCompare(y.inicio));
    const esActual = wk.some(dd => ymd(dd) === hy);
    return `<div class="semblk ${esActual?'act':''}">
      <div class="semhd">
        <span class="sw">SEMANA ${wi+1}</span>
        <span class="sf">${mm(wk[0])} al ${mm(wk[6])}</span>
        ${esActual?'<span class="shoy">SEMANA ACTUAL</span>':''}
        <span class="sn">${lista.length} proyecto${lista.length===1?'':'s'}</span>
      </div>
      ${lista.length ? `<div class="pgrid">${lista.map(p => fichaProyecto(p,a,b)).join("")}</div>`
                     : `<div class="semvacia">Sin proyectos programados esta semana</div>`}
    </div>`;}).join("");
}

function calendario(){
  const wks = semanasDe(S.mes.y, S.mes.m), hy = ymd(hoy());
  const enMes = proyectosDelMes();
  const mm = dt => dt.toLocaleDateString("es-CL",{day:"numeric",month:"short"});
  return `<div class="calwrap">
    <div class="calscroll"><div class="calinner">
    <div class="dow">${DOW.map((x,i) => `<div class="${i>4?'wknd':''}">${x}</div>`).join("")}</div>
    ${wks.map((wk,wi) => {
      const {segs, over} = carriles(wk);
      const esActual = wk.some(dd => ymd(dd) === hy);
      return `<div class="wkbox">
      <div class="wklab ${esActual?'actual':''}">
        <span>SEMANA ${wi+1} · ${mm(wk[0])} al ${mm(wk[6])}${esActual?'  ·  SEMANA ACTUAL':''}</span>
        <em>${segs.length+over.length} proyecto${(segs.length+over.length)===1?'':'s'}</em></div>
      <div class="wk">
        ${wk.map((dd,i) => `<div class="colbg ${i>4?'wknd':''} ${i===6?'last':''} ${ymd(dd)===hy?'today':''}"></div>`).join("")}
        ${wk.map((dd,i) => `<div class="dnum ${dd.getMonth()!==S.mes.m?'out':''} ${ymd(dd)===hy?'today':''}" style="grid-column:${i+1}">
            <span>${dd.getDate()}</span></div>`).join("")}
        ${segs.map(g => { const st = estado(g.p);
          const cap = g.contL && g.contR ? "" : g.contL ? "FIN" : g.contR ? "INICIO" : "INICIO › FIN";
          return `<div class="bar2 ${g.contL?'contL':''} ${g.contR?'contR':''}"
            title="${esc(g.p.nombre)} · ${esc(g.p.tipo)}\nEjecución: ${g.p.inicio} al ${g.p.termino}\nAvance ${pctTotal(g.p)}% · ${st.txt}"
            style="grid-column:${g.s+1}/span ${g.e-g.s+1};grid-row:${g.lane+2};background:${COLOR[st.k]}"
            onclick="abrir('${g.p.id}')">${cap?`<u>${cap}</u>`:''}<span class="nm">${g.contL?'‹ ':''}${esc(g.p.nombre)}${g.contR?' ›':''}</span><i>${pctTotal(g.p)}%</i></div>`;}).join("")}
        ${over.length?`<div class="more" onclick="S.vista='sem';render()">+${over.length} proyecto${over.length>1?'s':''} más esta semana — ver por semana</div>`:''}
      </div></div>`;}).join("")}
    </div></div>
    ${enMes.length?'':'<div class="card empty">No hay proyectos programados en este mes.</div>'}
  </div>
  <div class="leg">
    <span><b style="background:${COLOR.warn}"></b>En curso</span>
    <span><b style="background:${COLOR.bad}"></b>Atrasado</span>
    <span><b style="background:${COLOR.ready}"></b>Listo para acta</span>
    <span><b style="background:${COLOR.ok}"></b>Completado</span>
    <span><b style="background:${COLOR.idle}"></b>Por iniciar</span>
    <span>La barra parte el día de inicio y termina el día de término. ‹ › indica que el proyecto sigue en otra semana.</span>
  </div>`;
}

function tarjetas(){
  const lista = proyectosDelMes();
  if(!lista.length) return `<div class="card empty">No hay proyectos programados en ${MESES[S.mes.m]} ${S.mes.y}.</div>`;
  return `<div class="pgrid">${lista.map(p => fichaProyecto(p)).join("")}</div>`;
}

function fichaProyecto(p,a,b){
  const st = estado(p), t = pctTotal(p);
  const col = COLOR[st.k];
  const sig = p.checklist.etapas.find(e => pctEtapa(p,e) < 100);
  const f = a ? faseSemana(p,a,b) : null;
  return `<div class="card pcard" style="border-left-color:${col}" onclick="abrir('${p.id}')">
    <div class="pact">
      <button title="Editar proyecto" onclick="editarProyecto('${p.id}',event)">✎</button>
      <button title="Eliminar (archivar)" class="del" onclick="confirmarEliminar('${p.id}',event)">🗑</button>
    </div>
    <h3>${esc(p.nombre)}</h3>
    <div class="cl">${esc(p.cliente)} · ${esc(p.comuna)}</div>
    <span class="tag">${esc(p.tipo)}</span>${p.linea?`<span class="tag">${esc(p.linea)}</span>`:''}${f?`<span class="fase ${f.c}">${f.t}</span>`:''}
    <div style="margin-top:13px"><div class="bar"><b style="width:${t}%;background:${col}"></b></div>
    <div class="pct">${t}% · ${sig?`Etapa ${sig.n}: ${esc(sig.t)}`:p.completadoTs?`Completado el ${fdate(ymd(new Date(p.completadoTs)))}`:"Falta generar el acta"}</div></div>
    <div class="foot"><span>${fdate(p.inicio)} – ${fdate(p.termino)}</span><span><span class="dot s-${st.k}"></span>${st.txt}</span></div>
  </div>`;
}

/* ---------- DASHBOARD (Jefatura, y consulta del coordinador) ---------- */
function vistaJefatura(){
  const H = hoy();
  /* indicadores: toda la cartera activa, no solo el mes visible */
  const cartera = activos(), trabajo = enTrabajo();
  const enCurso = trabajo.filter(p => pctTotal(p) < 100);
  const atrasados = enCurso.filter(p => estado(p).k === "bad");
  const actasPend = trabajo.filter(p => pctTotal(p) === 100);
  const compl = completados();
  const complMes = compl.filter(p => p.completadoTs.slice(0,7) === `${H.getFullYear()}-${String(H.getMonth()+1).padStart(2,"0")}`).length;
  const al = alertas(trabajo);
  const etapas = tiemposPorEtapa(cartera);
  const inst = resumenInstaladores(cartera);
  const lista = proyectosDelMes();

  app.innerHTML = `
  <div class="ph"><div>
    <h1>Dashboard</h1>
    <p class="sub" style="margin:0">Indicadores de toda la cartera · hoy es ${H.toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
  </div><button class="btn p" onclick="nuevoProyecto()">+ Crear proyecto</button></div>
  <div class="kpis">
    <div class="card kpi"><div class="l">En curso</div><div class="v">${enCurso.length}</div><div class="d">checklist bajo el 100%</div></div>
    <div class="card kpi"><div class="l">Atrasados</div><div class="v" style="color:${atrasados.length?'var(--bad)':'var(--ok)'}">${atrasados.length}</div><div class="d">con alguna etapa vencida</div></div>
    <div class="card kpi"><div class="l">Actas pendientes</div><div class="v" style="color:${actasPend.length?'var(--ready)':'inherit'}">${actasPend.length}</div><div class="d">al 100%, falta generar el acta</div></div>
    <div class="card kpi"><div class="l">Completados</div><div class="v" style="color:var(--ok)">${compl.length}</div><div class="d">${complMes} este mes · ${cartera.length} en cartera</div></div>
  </div>

  <div class="dgrid">
    <div class="card">
      <div class="hd">Actas pendientes <span class="n">${actasPend.length}</span></div>
      ${actasPend.length ? actasPend.map(p => `<div class="alrow" onclick="abrir('${p.id}')">
          <div class="ic ic-ready">✓</div>
          <div><b>${esc(p.nombre)}</b><small>${esc(p.cliente)} · Coord. ${esc(p.coord)} · término ${fdate(p.termino)}</small></div></div>`).join("")
        : `<div class="alrow" style="color:var(--muted);cursor:default">No hay actas pendientes.</div>`}
    </div>
    <div class="card">
      <div class="hd">Alertas de etapas <span class="n">${al.length}</span></div>
      ${al.length ? al.slice(0,8).map(a => `<div class="alrow" onclick="abrir('${a.p.id}',${a.e.n})">
          <div class="ic ic-${a.sev}">!</div>
          <div><b>${esc(a.p.nombre)}</b> — ${a.txt}
          <small>${esc(a.e.t)} · ${a.pc}% · límite ${limite(a.p,a.e.n).toLocaleDateString("es-CL",{day:"2-digit",month:"short"})}</small></div></div>`).join("")
        + (al.length > 8 ? `<div class="alrow" style="color:var(--muted);cursor:default">y ${al.length-8} alerta(s) más</div>` : "")
        : `<div class="alrow" style="color:var(--muted);cursor:default">Todas las etapas están al día.</div>`}
    </div>
  </div>

  <div class="card" style="margin-top:20px">
    <div class="hd">Tiempos por etapa <span class="n">${cartera.length} proyectos</span></div>
    ${etapas.length ? `<div class="tablewrap"><table><thead><tr>
      <th>Etapa</th><th>Cerradas</th><th>Duración promedio</th><th>Cierre vs. límite</th><th>A tiempo</th>
    </tr></thead><tbody>
    ${etapas.map(r => `<tr class="nohover">
      <td><b>${r.n}.</b> ${esc(r.t)}</td>
      <td>${r.cerradas}</td>
      <td>${r.duracion == null ? "—" : `${fmtNum(r.duracion)} día${Math.round(r.duracion*10)===10?'':'s'}`}</td>
      <td>${fmtAtraso(r.atraso)}</td>
      <td style="min-width:110px"><div class="bar"><b style="width:${r.aTiempo}%;background:${r.aTiempo>=80?'var(--ok)':r.aTiempo>=50?'var(--warn)':'var(--bad)'}"></b></div><div class="pct">${r.aTiempo}%</div></td>
    </tr>`).join("")}
    </tbody></table></div>
    <div class="pmeta" style="padding:10px 15px">Duración: días desde que se cerró la etapa anterior (la etapa 1, desde el primer registro del proyecto). Cierre vs. límite: días antes (−) o después (+) de la fecha límite de la etapa.</div>`
      : `<div class="empty">Todavía no hay etapas cerradas para medir.</div>`}
  </div>

  <div class="card" style="margin-top:20px">
    <div class="hd">Por instalador <span class="n">${inst.length}</span></div>
    ${inst.length ? `<div class="tablewrap"><table><thead><tr>
      <th>Instalador</th><th>En curso</th><th>Atrasados</th><th>Terminados</th><th>Término (etapa 5) vs. límite</th>
    </tr></thead><tbody>
    ${inst.map(r => `<tr class="nohover">
      <td class="pname">${esc(r.inst)}</td>
      <td>${r.enCurso}</td>
      <td>${r.atrasados ? `<span style="color:var(--bad);font-weight:700">${r.atrasados}</span>` : "0"}</td>
      <td>${r.terminados}</td>
      <td>${fmtAtraso(r.atraso5)}</td>
    </tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Sin proyectos.</div>`}
  </div>

  <h2 class="sec">Cartera por mes</h2>
  <div class="calbar">${filtroTrabajo()}</div>
  ${barraMes(`
    <div class="resumen"><span class="cnt ${lista.length?'':'vacio'}">${lista.length
      ? `<b>${lista.length}</b> proyecto${lista.length===1?'':'s'} en ${MESES[S.mes.m]}`
      : `Sin proyectos en ${MESES[S.mes.m]} ${S.mes.y}`}</span></div>`)}
  <div class="card">
    ${lista.length ? `<div class="tablewrap"><table><thead><tr>
      <th>Proyecto</th><th>Tipo</th><th class="hideM">Fechas</th><th>Etapas 1 › 6</th><th>Avance</th><th>Estado</th>
    </tr></thead><tbody>
    ${lista.map(p => { const st = estado(p); return `<tr onclick="abrir('${p.id}')">
      <td><div class="pname">${esc(p.nombre)}</div><div class="pmeta">${esc(p.cliente)} · ${esc(p.comuna)}</div></td>
      <td><span class="tag">${esc(p.tipo)}</span>${p.linea?` <span class="tag">${esc(p.linea)}</span>`:''}</td>
      <td class="hideM"><div style="font-size:13px">${fdate(p.inicio)} – ${fdate(p.termino)}</div><div class="pmeta">Coord. ${esc(p.coord)}</div></td>
      <td><div class="mini">${p.checklist.etapas.map(e => { const v = pctEtapa(p,e);
        return `<i class="${v===100?'full':''}" title="Etapa ${e.n}: ${v}%"><b style="width:${v}%"></b></i>`; }).join("")}</div></td>
      <td style="min-width:110px"><div class="bar"><b style="width:${pctTotal(p)}%"></b></div><div class="pct">${pctTotal(p)}%</div></td>
      <td><span class="dot s-${st.k}"></span>${st.txt}</td>
    </tr>`;}).join("")}
    </tbody></table></div>` : `<div class="empty">No hay proyectos ${S.filtro==='completados'?'completados':'en trabajo'} en este mes.</div>`}
  </div>`;
}

/* número con un decimal, coma decimal (es-CL) */
const fmtNum = x => (Math.round(x*10)/10).toLocaleString("es-CL", {maximumFractionDigits:1});
/* días antes (−, verde) o después (+, rojo) de la fecha límite */
function fmtAtraso(x){
  if(x == null) return "—";
  const r = Math.round(x*10)/10;
  if(r === 0) return `<span style="color:var(--ok);font-weight:700">en el límite</span>`;
  return r > 0
    ? `<span style="color:var(--bad);font-weight:700">+${fmtNum(r)} días</span>`
    : `<span style="color:var(--ok);font-weight:700">${fmtNum(-r)} días antes</span>`;
}

/* ---------- DETALLE DE PROYECTO ---------- */
function vistaDetalle(){
  const p = S.proyectos.find(x => x.id === S.abierto);
  if(!p){ S.abierto = null; return render(); }
  const st = estado(p), t = pctTotal(p), H = hoy(), ro = RO();
  const auto = (p.checklist.etapas.find(e => pctEtapa(p,e) < 100) || {n:6}).n;
  const abierta = S.openSt === undefined ? auto : S.openSt;

  app.innerHTML = `
  <button class="back" onclick="cerrarDetalle()">‹ Volver</button>
  <div class="card dhead">
    <div class="info"><h2>${esc(p.nombre)}${ro ? '<span class="rochip">SOLO LECTURA</span>' : ''}</h2>
      <div class="pmeta">${esc(p.cliente)} · ${esc(p.comuna)} · ${p.id} · Coord. ${esc(p.coord)}</div>
      <div style="margin-top:8px"><span class="tag">${esc(p.tipo)}</span>
      ${p.linea?`<span class="tag">${esc(p.linea)}</span>`:''}
      <span class="tag">Instalador: ${esc(p.inst)}</span>
      <span class="tag">${fdate(p.inicio)} – ${fdate(p.termino)}</span></div></div>
    <div style="min-width:190px"><div class="bar" style="height:10px"><b style="width:${t}%"></b></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12.5px">
        <span style="font-weight:700">${t}% completado</span><span><span class="dot s-${st.k}"></span>${st.txt}</span></div>
      <div style="display:flex;gap:7px;margin-top:11px">
        <button class="evbtn" style="flex:1" onclick="editarProyecto('${p.id}')">✎ Editar</button>
        <button class="evbtn del" style="flex:1" onclick="confirmarEliminar('${p.id}')">🗑 Eliminar</button></div>
    </div>
    <div class="steps">${p.checklist.etapas.map(e => { const v = pctEtapa(p,e), venc = limite(p,e.n) < H && v < 100;
      return `<button class="step ${v===100?'done':venc?'late':''} ${abierta===e.n?'cur':''}" onclick="irEtapa(${e.n})" title="${esc(e.t)}">
        <span class="sn">${v===100?'✓':e.n}</span><span class="sb"><b style="width:${v}%"></b></span><span class="sp">${v}%</span></button>`; }).join("")}
    </div>
  </div>
  ${p.checklist.etapas.map(e => {
    const list = e.items, v = pctEtapa(p,e), lim = limite(p,e.n);
    const vencida = lim < H && v < 100;
    return `<div class="card stage ${abierta===e.n?'open':''}" id="etapa-${e.n}">
      <div class="sthead" onclick="toggleEtapa(${e.n})">
        <div class="stn ${v===100?'done':(abierta===e.n?'act':'')}">${v===100?'✓':e.n}</div>
        <div class="sttl"><b>${e.n}. ${esc(e.t)}</b>
          <small>${esc(e.hito)} · límite ${lim.toLocaleDateString("es-CL",{day:"2-digit",month:"short"})}${vencida?' · <span style="color:var(--bad);font-weight:700">VENCIDA</span>':''} · ${list.filter(i=>p.av[i.id]?.ok).length}/${list.length} ítems</small></div>
        <div style="min-width:80px"><div class="bar"><b style="width:${v}%;background:${v===100?'var(--ok)':'var(--brand)'}"></b></div></div>
        <div class="chev">${abierta===e.n?'▲':'▼'}</div>
      </div>
      <div class="stbody">
      ${list.map(i => filaItem(p,i,ro)).join("")}
      </div></div>`;}).join("")}
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;gap:12px;flex-wrap:wrap">
    <span class="pmeta">${ro ? "Jefatura tiene lectura sobre el checklist; los registros en terreno los hace el Coordinador." : ""}</span>
    <button class="btn ${t===100?'p':'g'}" onclick="verActa()" ${t===100?'':'disabled'}>
      ${t===100?(p.completadoTs?'Ver acta de recepción':'Generar acta de recepción'):'Acta disponible al 100%'}</button>
  </div>
  <div class="card alerts">
    <div class="hd">Actividad y auditoría del proyecto <span class="n">${S.auditProy.length}</span></div>
    ${S.auditProy.length ? S.auditProy.map(a => `
      <div class="audrow"><span class="at">${fts(a.ts)}</span>
        <span><b>${esc(a.user)}</b> · ${esc(etiquetaAccion(a.accion))}${a.detalle?` — ${esc(a.detalle)}`:""}</span></div>`).join("")
      : `<div class="audrow" style="color:var(--muted)">Sin actividad registrada aún.</div>`}
  </div>
  ${barraSiguiente(p, ro)}`;
}

function filaItem(p,i,ro){
  const a = p.av[i.id];
  const hist = (p.avArchivado || []).filter(h => h.itemId === i.id);
  const ev = a?.evidenciaId ? S.evCache.get(a.evidenciaId) : null;
  const libre = i.ev !== "obligatoria";   // opcional: check directo, sin popup (obligatorio: popup de siempre)
  return `<div class="item ${a?.ok?'done':''}">
    <button class="cb ${a?.ok?'on':''}" ${ro?'disabled':`onclick="${libre?`toggleLibre('${i.id}')`:`toggle('${i.id}')`}"`}
      title="${a?.ok ? (ro?'':'Reabrir ítem') : (ro?'':'Registrar cumplimiento')}">${a?.ok?'✓':''}</button>
    <div class="itxt"><span class="inum">${i.id}</span>${esc(i.x)}
      ${i.ev==="obligatoria"?'<span class="req">Requiere evidencia</span>':''}
      ${i.cond?'<span class="only">Solo piscinas</span>':''}
      ${a?.ok?`<div class="stamp">✓ ${fts(a.ts)} · ${esc(a.user)}${a.geo?` · 📍 <span title="Registrado en terreno">${a.geo.lat}, ${a.geo.lng}</span>`:""}</div>`:''}
      ${a?.nota?`<div class="note">${esc(a.nota)}</div>`:''}
      ${hist.length?`<button class="histlink" onclick="verHistorial('${i.id}')">Ver historial del ítem (${hist.length})</button>`:''}
    </div>
    ${ev
      ? `<div style="display:flex;align-items:center;gap:6px">
          <img class="thumb" src="${ev.url}" title="Ver evidencia" onclick="verEvidencia('${a.evidenciaId}')">
          ${(libre && !ro) ? `<button class="evbtn" onclick="abrirDetalleOpcional('${i.id}')" title="Reemplazar evidencia u observación">✎</button>` : ""}
        </div>`
      : ro ? ""
      : libre ? `<button class="evbtn" onclick="abrirDetalleOpcional('${i.id}')">${a?.ok?'＋ Evidencia/nota':'＋ Adjuntar (opcional)'}</button>`
      : (a?.ok ? "" : `<button class="evbtn" onclick="toggle('${i.id}')">Adjuntar evidencia</button>`)}
  </div>`;
}

function etiquetaAccion(a){
  return ({
    proyecto_creado:"creó el proyecto", proyecto_editado:"editó el proyecto",
    proyecto_archivado:"eliminó el proyecto (archivado)", proyecto_restaurado:"restauró el proyecto",
    item_cerrado:"cerró un ítem", item_editado:"editó la evidencia/nota de un ítem", item_reabierto:"reabrió un ítem",
    evidencia_cargada:"cargó una evidencia", acta_generada:"generó el acta de recepción",
    proyecto_completado:"marcó el proyecto como completado",
    ingreso:"ingresó a la plataforma", salida:"cerró sesión", password_cambiado:"cambió su contraseña",
    ingreso_fallido:"intento de ingreso fallido", pin_restablecido:"restableció un PIN",
    configuracion_inicial:"configuración inicial", respaldo_exportado:"exportó un respaldo",
    respaldo_importado:"importó un respaldo", rol_cambiado:"cambió el rol de un usuario",
    usuario_invitado:"invitó a un usuario",
    catalogo_etapa_editada:"editó una etapa del catálogo", catalogo_item_creado:"creó un ítem del catálogo",
    catalogo_item_editado:"editó un ítem del catálogo", catalogo_item_archivado:"quitó un ítem del catálogo",
    catalogo_item_restaurado:"restauró un ítem del catálogo",
    instalador_creado:"agregó un instalador", instalador_editado:"editó un instalador",
    instalador_archivado:"quitó un instalador", instalador_restaurado:"restauró un instalador",
  })[a] || a;
}

/* barra fija abajo: el siguiente ítem pendiente, o generar el acta al 100% */
function barraSiguiente(p, ro){
  const sig = siguientePendiente(p);
  if(sig && !ro){
    const libre = sig.it.ev !== "obligatoria";
    return `<div class="nextspace"></div><div class="nextbar"><div class="nbin">
      <div class="nbtx"><small>Siguiente · Etapa ${sig.e.n}</small><span><b>${esc(sig.it.id)}</b> ${esc(sig.it.x)}</span></div>
      ${libre
        ? `<button class="btn g nbb" onclick="abrirDetalleOpcional('${sig.it.id}')">＋ Foto</button>
           <button class="btn p nbb" onclick="toggleLibre('${sig.it.id}')">✓ Marcar</button>`
        : `<button class="btn p nbb" onclick="toggle('${sig.it.id}')">📷 Registrar</button>`}
    </div></div>`;
  }
  if(!sig && !p.completadoTs){
    return `<div class="nextspace"></div><div class="nextbar"><div class="nbin">
      <div class="nbtx"><small>Checklist al 100%</small><span>Falta generar el acta de recepción</span></div>
      <button class="btn p nbb" onclick="verActa()">Generar acta</button>
    </div></div>`;
  }
  return "";
}
function irEtapa(n){
  S.openSt = n; render();
  document.getElementById(`etapa-${n}`)?.scrollIntoView({behavior:"smooth", block:"start"});
}
function toggleEtapa(n){
  const p = S.proyectos.find(x => x.id === S.abierto);
  const auto = (p.checklist.etapas.find(e => pctEtapa(p,e) < 100) || {n:6}).n;
  const abierta = S.openSt === undefined ? auto : S.openSt;
  S.openSt = abierta === n ? null : n;
  render();
}
function cerrarDetalle(){ S.abierto = null; S.openSt = undefined; render(); window.scrollTo(0,0); }

/* ---------- visor de evidencia e historial ---------- */
function verEvidencia(evId){
  const ev = S.evCache.get(evId);
  if(!ev) return toast("No se encontró la evidencia.");
  const m = ev.meta;
  abrirModal(`
    <h3>Evidencia</h3>
    <div class="viewer"><img src="${ev.url}" alt="Evidencia">
    <div class="vmeta">Cargada el ${fts(m.ts)} por ${esc(m.user)}
    ${m.hash?`<br>Huella SHA-256: ${m.hash.slice(0,24)}…`:""}</div></div>
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cerrar</button></div>`, true);
}

function verHistorial(itemId){
  const p = S.proyectos.find(x => x.id === S.abierto);
  const hist = (p.avArchivado || []).filter(h => h.itemId === itemId)
    .sort((a,b) => (b.archivadoTs||"").localeCompare(a.archivadoTs||""));
  abrirModal(`
    <h3>Historial · ítem ${esc(itemId)}</h3>
    <p class="q">${esc(textoItem(itemId))}</p>
    ${hist.map(h => { const ev = h.evidenciaId ? S.evCache.get(h.evidenciaId) : null;
      return `<div class="hrow">
      ${ev?`<img class="thumb" src="${ev.url}" onclick="verEvidencia('${h.evidenciaId}')">`:""}
      <div class="hmeta">Cerrado el ${fts(h.ts)} por ${esc(h.user)}
        ${h.nota?`<div class="note">${esc(h.nota)}</div>`:""}
        <small>Archivado el ${fts(h.archivadoTs)} · ${esc(h.motivo)}</small>
      </div></div>`; }).join("")}
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cerrar</button></div>`, true);
}

/* ---------- PROYECTOS ARCHIVADOS ---------- */
function vistaArchivados(){
  const lista = S.proyectos.filter(p => p.archivado)
    .sort((a,b) => (b.archivadoTs||"").localeCompare(a.archivadoTs||""));
  app.innerHTML = `
  <button class="back" onclick="S.pantalla=null;render()">‹ Volver</button>
  <div class="ph"><div><h1>Proyectos archivados</h1>
    <p class="sub" style="margin:0">Eliminados de forma lógica: sus evidencias y auditoría se conservan como respaldo (RN-13).</p></div></div>
  ${lista.length ? `<div class="card">${lista.map(p => `
    <div class="alrow" style="cursor:default">
      <div style="flex:1"><b>${esc(p.nombre)}</b> <span class="tag">${esc(p.tipo)}</span>
        <small>${esc(p.cliente)} · ${fdate(p.inicio)} – ${fdate(p.termino)} ·
        ${itemsDe(p).filter(i=>p.av[i.id]?.ok).length} ítems cerrados · archivado el ${p.archivadoTs?fts(p.archivadoTs):"—"}</small></div>
      <button class="evbtn" onclick="restaurarProyecto('${p.id}')">Restaurar</button>
    </div>`).join("")}</div>`
    : `<div class="card empty">No hay proyectos archivados.</div>`}`;
}

/* ---------- USUARIOS (Jefatura) ---------- */
function vistaUsuarios(){
  const lista = [...S.usuarios].sort((a,b) => a.nombre.localeCompare(b.nombre));
  const totalJefatura = S.usuarios.filter(u => u.rol === "jefatura").length;
  app.innerHTML = `
  <button class="back" onclick="S.pantalla=null;render()">‹ Volver</button>
  <div class="ph"><div><h1>Usuarios</h1>
    <p class="sub" style="margin:0">${lista.length} cuenta${lista.length===1?'':'s'} · Coordinador y Jefatura pueden tener varios titulares.</p></div>
    <button class="btn p" onclick="abrirInvitarUsuario()">Agregar usuario</button></div>
  <div class="card">${lista.map(u => `
    <div class="alrow" style="cursor:default">
      <div style="flex:1"><b>${esc(u.nombre)}</b> <span class="tag">${u.rol === "jefatura" ? "Jefatura" : "Coordinador"}</span>
        ${u.id === S.sesion.userId ? '<small>Esta es tu cuenta</small>' : ''}
        ${!u.activo ? '<small style="color:var(--bad,#d8453c)">Cuenta inactiva</small>' : ''}</div>
      ${u.rol === "coordinador"
        ? `<button class="evbtn" onclick="cambiarRolUsuario('${u.id}','jefatura')">Ascender a Jefatura</button>`
        : (totalJefatura <= 1
            ? `<button class="evbtn" disabled title="Es la única cuenta Jefatura: no puede quedar el sistema sin ninguna">Pasar a Coordinador</button>`
            : `<button class="evbtn" onclick="cambiarRolUsuario('${u.id}','coordinador')">Pasar a Coordinador</button>`)}
    </div>`).join("")}</div>`;
}

/* ---------- CATÁLOGO DE ÍTEMS (Jefatura) ---------- */
function vistaCatalogo(){
  app.innerHTML = `
  <button class="back" onclick="S.pantalla=null;render()">‹ Volver</button>
  <div class="ph"><div><h1>Catálogo de ítems</h1>
    <p class="sub" style="margin:0">Se usa para armar el checklist de los proyectos nuevos y al cambiar el tipo de
    un proyecto existente (RN-12). Los proyectos ya creados no cambian: cada uno guarda su propia copia.</p></div>
    <button class="btn g" onclick="verItemsArchivadosCatalogo()">Ítems archivados</button></div>
  ${ETAPAS.map(e => `
    <div class="card" style="margin-bottom:14px">
      <div class="hd">
        <span style="flex:1">Etapa ${e.n} · ${esc(e.t)} <span class="tag">${esc(e.hito)}</span></span>
        <button class="evbtn" onclick="formEtapaCatalogo(${e.n})">✎ Editar etapa</button>
      </div>
      ${e.items.map(i => `
        <div class="alrow" onclick="formItemCatalogo('${i.id}',${e.n})">
          <div style="flex:1"><b>${esc(i.id)}</b> ${esc(i.x)}
            ${i.ev==="obligatoria"?'<span class="req">Requiere evidencia</span>':''}
            ${i.ap!=="*"?`<span class="only">Solo ${esc(i.ap.join(", "))}</span>`:''}</div>
        </div>`).join("")}
      <div class="alrow" style="cursor:pointer;color:var(--brand);font-weight:650" onclick="formItemCatalogo(null,${e.n})">+ Agregar ítem a esta etapa</div>
    </div>`).join("")}`;
}

/* ---------- INSTALADORES (Jefatura) ---------- */
function vistaInstaladores(){
  const lista = [...INSTALADORES].sort((a,b) => a.nombre.localeCompare(b.nombre));
  app.innerHTML = `
  <button class="back" onclick="S.pantalla=null;render()">‹ Volver</button>
  <div class="ph"><div><h1>Instaladores</h1>
    <p class="sub" style="margin:0">Lista de instaladores externos disponible al crear o editar un proyecto.</p></div>
    <div style="display:flex;gap:9px">
      <button class="btn g" onclick="verInstaladoresArchivados()">Archivados</button>
      <button class="btn p" onclick="formInstalador(null)">+ Agregar instalador</button>
    </div></div>
  <div class="card">${lista.length ? lista.map(i => `
    <div class="alrow" onclick="formInstalador('${i.id}')">
      <div style="flex:1"><b>${esc(i.nombre)}</b></div>
    </div>`).join("") : `<div class="empty">Aún no hay instaladores registrados.</div>`}</div>`;
}

/* ---------- ACTA DE RECEPCIÓN ---------- */
function vistaActa(){
  const p = S.proyectos.find(x => x.id === S.abierto);
  if(!p){ S.pantalla = null; return render(); }
  app.innerHTML = `
  <div class="actabar noprint">
    <button class="back" style="margin:0" onclick="S.pantalla=null;render()">‹ Volver al proyecto</button>
    <button class="btn p" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>
  </div>
  <div class="acta">
    <h1>Acta de recepción conforme — ${esc(p.nombre)}</h1>
    <div class="am">${p.id} · ${esc(p.cliente)} · ${esc(p.comuna)} · ${esc(p.tipo)}<br>
    Ejecución ${p.inicio} al ${p.termino} · Coordinador ${esc(p.coord)} · Instalador ${esc(p.inst)}<br>
    ${p.completadoTs ? `Proyecto completado el ${new Date(p.completadoTs).toLocaleString("es-CL")}${(n => n ? ` por ${esc(n)}` : "")(S.usuarios.find(u => u.id === p.completadoPor)?.nombre)}<br>` : ""}
    Documento generado el ${new Date().toLocaleString("es-CL")}</div>
    ${p.checklist.etapas.map(e => `<h2>${e.n}. ${esc(e.t)}</h2>
      <div class="tablewrap"><table>${e.items.map(i => { const a = p.av[i.id];
        const ev = a?.evidenciaId ? S.evCache.get(a.evidenciaId) : null;
        return `<tr>
        <td style="width:30px">${a?.ok?"✓":"—"}</td>
        <td style="width:36px;color:#6b7c8f">${i.id}</td>
        <td>${esc(i.x)}${a?.nota?`<br><span class="obs">${esc(a.nota)}</span>`:""}</td>
        <td style="width:120px;color:#6b7c8f">${a?new Date(a.ts).toLocaleString("es-CL"):""}</td>
        <td style="width:54px">${ev?`<img src="${ev.url}" onclick="verEvidencia('${a.evidenciaId}')">`:""}</td></tr>`;}).join("")}
      </table></div>`).join("")}
    <div class="firma">_______________________________<br>Recepción conforme del cliente<br>
    <span style="color:#6b7c8f;font-size:12px">Nombre, firma y fecha</span></div>
  </div>`;
  window.scrollTo(0,0);
}
