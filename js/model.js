/* =====================================================================
   MODELO DE DOMINIO Y LÓGICA DE NEGOCIO
   Sin dependencias de DOM ni de almacenamiento: esta capa se porta
   tal cual a un backend (Supabase) en la fase siguiente.
   Fuente de las reglas: Especificación funcional v1.1 (RN-1 a RN-14).
   ===================================================================== */

const CATALOGO_VERSION = 1;
const TIPOS = ["Piscina","Tiny House"];
const LINEAS_PISCINA = ["SWIM","SMARTPOOLS"];   // solo aplica cuando tipo === "Piscina"

/* Catálogo de etapas e ítems.
   ev: 'obligatoria' -> no se puede cerrar sin evidencia (RN-1)
   ap: tipos a los que aplica ('*' = todos)
   Editable desde Menú → Catálogo de ítems (solo Jefatura): vive en las
   tablas etapas_catalogo/items_catalogo y se carga en tiempo de ejecución
   vía cargarCatalogo() (db.js), llamada desde cargarEstado(). Nada aquí
   se evalúa antes del login, así que esta lista arranca vacía sin riesgo.
   Los proyectos ya creados no se ven afectados por ediciones futuras:
   cada uno guarda su propia copia (snapshotChecklist) al crearse. */
let ETAPAS = [];

/* ---------- estado global de la aplicación ---------- */
const S = {
  hayCuentas: null,      // null = aún no se sabe · true/false tras consultar Supabase
  recuperando: false,    // true = llegó desde el enlace de "recuperar contraseña"
  usuarios: [],          // perfiles (profiles) visibles para el usuario autenticado
  proyectos: [],         // cache de proyectos visibles según el rol (RLS)
  sesion: null,          // {userId, nombre, rol}
  panel: "proyectos",    // coordinador: "proyectos" | "dashboard"
  vista: "sem",          // "sem" | "cal" | "list"
  pantalla: null,        // null | "archivados" | "acta"
  abierto: null,         // id del proyecto en detalle
  openSt: undefined,     // etapa abierta (undefined = automática, null = todas cerradas)
  mes: null,             // {y, m}
  evCache: new Map(),    // evidenciaId -> {url, meta} del proyecto abierto
  auditProy: [],         // auditoría del proyecto abierto
  notificaciones: [],    // notificaciones propias (tabla notificaciones), solo eventos ("ítem cerrado")
  notiAbierta: false,    // panel de la campanita
};

/* ---------- utilidades ---------- */
const d    = s => new Date(s + "T12:00:00");
const ymd  = dt => dt.getFullYear() + "-" + String(dt.getMonth()+1).padStart(2,"0") + "-" + String(dt.getDate()).padStart(2,"0");
const addD = (dt,n) => { const c = new Date(dt); c.setDate(c.getDate()+n); return c; };
const hoy  = () => { const x = new Date(); x.setHours(12,0,0,0); return x; };
const esc  = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fdate = s => d(s).toLocaleDateString("es-CL",{day:"2-digit",month:"short"});
const fts  = s => new Date(s).toLocaleString("es-CL",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
const uid  = pref => pref + Date.now().toString(36) + Math.random().toString(36).slice(2,7);

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DOW   = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const COLOR = {ok:"#1a9e63", bad:"#d8453c", warn:"#0f6fb8", idle:"#8fa3b5"};
const MAXLANE = 3;   // RN-11: hasta 3 proyectos simultáneos por día

/* ---------- checklist por proyecto ----------
   Cada proyecto guarda una copia (snapshot) de los ítems aplicables a su
   tipo, anclada a la versión del catálogo con la que se creó. Así, futuras
   ediciones del catálogo no alteran proyectos en curso.                  */
function snapshotChecklist(tipo){
  return {
    version: CATALOGO_VERSION,
    etapas: ETAPAS.map(e => ({
      n: e.n, t: e.t, hito: e.hito,
      items: e.items
        .filter(i => i.ap === "*" || i.ap.includes(tipo))
        .map(i => ({id: i.id, x: i.x, ev: i.ev, cond: i.ap !== "*"}))
    })).filter(e => e.items.length)
  };
}
function textoItem(id){
  const it = ETAPAS.flatMap(e => e.items).find(i => i.id === id);
  return it ? it.x : "(ítem de una versión anterior del catálogo)";
}

const itemsDe  = p => p.checklist.etapas.flatMap(e => e.items);
/* RN-9: el avance se calcula solo sobre los ítems aplicables al tipo */
const pctEtapa = (p,e) => { const l = e.items; if(!l.length) return 100;
  return Math.round(l.filter(i => p.av[i.id]?.ok).length / l.length * 100); };
const pctTotal = p => { const l = itemsDe(p); if(!l.length) return 0;
  return Math.round(l.filter(i => p.av[i.id]?.ok).length / l.length * 100); };

/* RN-5: fecha límite por etapa */
function limite(p,n){
  const ini = d(p.inicio), fin = d(p.termino);
  return [null, addD(ini,-5), addD(ini,-1), ini, addD(fin,-1), fin, fin][n];
}

/* RN-6: semáforo del proyecto */
function estado(p){
  const t = pctTotal(p), H = hoy();
  const atras = p.checklist.etapas.some(e => limite(p,e.n) < H && pctEtapa(p,e) < 100);
  if(t === 100) return {k:"ok",  txt:"Cerrado"};
  if(atras)     return {k:"bad", txt:"Atrasado"};
  if(d(p.inicio) > H && t === 0) return {k:"idle", txt:"Por iniciar"};
  return {k:"warn", txt:"En curso"};
}

/* RN-7: alertas por etapa vencida (roja) o por vencer hoy/mañana (amarilla) */
function alertas(lista){
  const out = [], H = hoy();
  lista.forEach(p => p.checklist.etapas.forEach(e => {
    const pc = pctEtapa(p,e); if(pc === 100) return;
    const lim = limite(p,e.n), dias = Math.round((lim - H) / 864e5);
    if(dias < 0)       out.push({sev:"bad",  p, e, pc, dias, txt:`Etapa ${e.n} vencida hace ${Math.abs(dias)} día(s)`});
    else if(dias <= 1) out.push({sev:"warn", p, e, pc, dias, txt:`Etapa ${e.n} vence ${dias === 0 ? "hoy" : "mañana"}`});
  }));
  return out.sort((a,b) => a.sev === b.sev ? a.dias - b.dias : (a.sev === "bad" ? -1 : 1));
}

/* ---------- calendario ---------- */
const activos = () => S.proyectos.filter(p => !p.archivado);

function proyectosDelMes(){
  const a = ymd(new Date(S.mes.y, S.mes.m, 1)), b = ymd(new Date(S.mes.y, S.mes.m + 1, 0));
  return activos().filter(p => p.inicio <= b && p.termino >= a);
}

function semanasDe(y,m){
  const first = new Date(y,m,1), off = (first.getDay()+6) % 7;   // lunes = 0
  const start = new Date(y,m,1-off), last = new Date(y,m+1,0);
  const wk = [];
  for(let c = new Date(start); c <= last || wk.length < 1; c.setDate(c.getDate()+7)){
    wk.push([...Array(7)].map((_,i) => { const x = new Date(c); x.setDate(c.getDate()+i); return x; }));
    if(wk[wk.length-1][6] >= last) break;
  }
  return wk;
}

/* RN-11: asigna carriles a los proyectos que cruzan la semana */
function carriles(wk){
  const a = ymd(wk[0]), b = ymd(wk[6]);
  const segs = activos().filter(p => p.inicio <= b && p.termino >= a)
    .sort((x,y) => x.inicio.localeCompare(y.inicio) || x.termino.localeCompare(y.termino))
    .map(p => {
      let s = wk.findIndex(dd => ymd(dd) >= p.inicio); if(s < 0) s = 0;
      let e = 6; for(let i = 6; i >= 0; i--){ if(ymd(wk[i]) <= p.termino){ e = i; break; } }
      return {p, s: Math.max(0,s), e: Math.min(6,e), contL: p.inicio < a, contR: p.termino > b};
    });
  const lanes = [[],[],[]], over = [];
  segs.forEach(g => {
    const l = lanes.findIndex(L => L.every(o => g.s > o.e || g.e < o.s));
    if(l >= 0 && l < MAXLANE) lanes[l].push({...g, lane:l}); else over.push(g);
  });
  return {segs: lanes.flat(), over};
}

/* RN-10: etiqueta de fase del proyecto en una semana dada */
function faseSemana(p,a,b){
  const ini = p.inicio >= a && p.inicio <= b, fin = p.termino >= a && p.termino <= b;
  if(ini && fin) return {t:"Inicia y termina", c:"f-full"};
  if(ini)        return {t:"Inicia esta semana", c:"f-ini"};
  if(fin)        return {t:"Termina esta semana", c:"f-fin"};
  return {t:"En ejecución", c:"f-mid"};
}
