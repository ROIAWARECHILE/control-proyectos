/* =====================================================================
   SESIÓN — Supabase Auth (correo + contraseña)
   El rol (coordinador / jefatura) vive en la tabla profiles y lo aplica
   Postgres vía RLS (supabase/schema.sql); esta capa solo intermedia
   con supabase-js y mantiene S.sesion sincronizado para la UI.
   ===================================================================== */

async function cargarSesionDesdePerfil(user){
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if(error || !data){ S.sesion = null; return; }
  S.sesion = {userId: data.id, nombre: data.nombre, rol: data.rol};
}

async function restaurarSesion(){
  const { data: {session} } = await sb.auth.getSession();
  if(session) await cargarSesionDesdePerfil(session.user);
}

function conectarCambiosAuth(){
  sb.auth.onAuthStateChange((event) => {
    if(event === "PASSWORD_RECOVERY"){ S.recuperando = true; render(); }
    if(event === "SIGNED_OUT"){ S.sesion = null; S.abierto = null; S.pantalla = null; S.recuperando = false; render(); }
  });
}

/* ---------- primera vez: crear las dos cuentas ---------- */
async function crearCuentas(){
  const g = k => document.getElementById(k).value.trim();
  const msg = m => { const b = document.getElementById("authMsg"); b.textContent = m; b.style.display = "block"; };
  const nc = g("suNomC"), ec = g("suEmailC"), pc = g("suPassC"), pc2 = g("suPassC2");
  const nj = g("suNomJ"), ej = g("suEmailJ"), pj = g("suPassJ"), pj2 = g("suPassJ2");
  if(!nc || !ec || !nj || !ej) return msg("Completa nombre y correo de ambas cuentas.");
  if(pc.length < 6 || pj.length < 6) return msg("Cada contraseña debe tener al menos 6 caracteres.");
  if(pc !== pc2) return msg("La contraseña del Coordinador no coincide con su confirmación.");
  if(pj !== pj2) return msg("La contraseña de Jefatura no coincide con su confirmación.");
  if(ec.toLowerCase() === ej.toLowerCase()) return msg("Usa un correo distinto para cada cuenta.");

  const btn = document.getElementById("suBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Creando cuentas…"; }

  const r1 = await sb.auth.signUp({email: ec, password: pc, options: {data: {nombre: nc, rol: "coordinador"}}});
  if(r1.error){
    if(btn){ btn.disabled = false; btn.textContent = "Crear cuentas y comenzar"; }
    return msg("Coordinador: " + r1.error.message);
  }
  const r2 = await sb.auth.signUp({email: ej, password: pj, options: {data: {nombre: nj, rol: "jefatura"}}});
  if(r2.error){
    if(btn){ btn.disabled = false; btn.textContent = "Crear cuentas y comenzar"; }
    return msg("Jefatura: " + r2.error.message + " La cuenta de Coordinador ya quedó creada; puedes reintentar solo la de Jefatura desde el ingreso.");
  }
  await sb.auth.signOut();
  const necesitaConfirmar = !r1.data.session || !r2.data.session;
  toast(necesitaConfirmar
    ? "Cuentas creadas. Revisen el correo de cada cuenta para confirmarla antes de ingresar."
    : "Cuentas creadas. Ya pueden ingresar.");
  S.hayCuentas = true;
  S.pantalla = null;
  render();
}

/* ---------- alta de una cuenta nueva (tras el arranque inicial) ----------
   Siempre queda como 'coordinador': el rol 'jefatura' no se puede
   autoasignar por registro público (lo aplica el trigger en schema.sql).
   Una Jefatura ya activa la asciende después desde Menú → Usuarios. */
async function crearCuentaPropia(){
  const g = k => document.getElementById(k).value.trim();
  const msg = m => { const b = document.getElementById("ccMsg"); b.textContent = m; b.style.display = "block"; };
  const nom = g("ccNom"), email = g("ccEmail"), pass = g("ccPass"), pass2 = g("ccPass2");
  if(!nom || !email) return msg("Completa tu nombre y correo.");
  if(pass.length < 6) return msg("La contraseña debe tener al menos 6 caracteres.");
  if(pass !== pass2) return msg("Las contraseñas no coinciden.");

  const btn = document.getElementById("ccBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Creando cuenta…"; }
  const { data, error } = await sb.auth.signUp({email, password: pass, options: {data: {nombre: nom}}});
  if(error){
    if(btn){ btn.disabled = false; btn.textContent = "Crear cuenta"; }
    return msg(error.message);
  }
  if(data.session) await sb.auth.signOut();   // vuelve a la pantalla de ingreso, igual que en la configuración inicial
  cerrarModal();
  toast(data.session
    ? "Cuenta creada. Ya puedes ingresar."
    : "Cuenta creada. Revisa tu correo para confirmarla antes de ingresar.");
}

/* ---------- crear la primera cuenta Jefatura (recuperación de arranque) ----------
   Solo tiene efecto mientras no exista ninguna Jefatura (lo aplica el mismo
   trigger que la configuración inicial); por eso vistaLogin() solo ofrece
   este botón cuando S.hayJefatura === false. */
async function crearCuentaJefatura(){
  const g = k => document.getElementById(k).value.trim();
  const msg = m => { const b = document.getElementById("cjMsg"); b.textContent = m; b.style.display = "block"; };
  const nom = g("cjNom"), email = g("cjEmail"), pass = g("cjPass"), pass2 = g("cjPass2");
  if(!nom || !email) return msg("Completa el nombre y el correo.");
  if(pass.length < 6) return msg("La contraseña debe tener al menos 6 caracteres.");
  if(pass !== pass2) return msg("Las contraseñas no coinciden.");

  const btn = document.getElementById("cjBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Creando cuenta…"; }
  const { data, error } = await sb.auth.signUp({email, password: pass, options: {data: {nombre: nom, rol: "jefatura"}}});
  if(error){
    if(btn){ btn.disabled = false; btn.textContent = "Crear cuenta Jefatura"; }
    return msg(error.message);
  }
  if(data.session) await sb.auth.signOut();
  S.hayJefatura = true;
  cerrarModal();
  toast(data.session
    ? "Cuenta Jefatura creada. Ya puedes ingresar."
    : "Cuenta Jefatura creada. Revisa tu correo para confirmarla antes de ingresar.");
  render();
}

/* ---------- ingreso ---------- */
async function ingresar(){
  const email = document.getElementById("liEmail").value.trim();
  const pass = document.getElementById("liPass").value;
  const msg = m => { const b = document.getElementById("authMsg"); b.textContent = m; b.style.display = "block"; };
  if(!email || !pass) return msg("Ingresa tu correo y contraseña.");

  const btn = document.getElementById("liBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Ingresando…"; }
  const { data, error } = await sb.auth.signInWithPassword({email, password: pass});
  if(error){
    if(btn){ btn.disabled = false; btn.textContent = "Ingresar"; }
    return msg(/invalid/i.test(error.message) ? "Correo o contraseña incorrectos." : error.message);
  }
  await cargarSesionDesdePerfil(data.user);
  if(!S.sesion){
    await sb.auth.signOut();
    if(btn){ btn.disabled = false; btn.textContent = "Ingresar"; }
    return msg("Tu cuenta no tiene un perfil asociado en esta plataforma.");
  }
  S.panel = "proyectos"; S.abierto = null; S.pantalla = null;
  try{ await cargarEstado(); }catch(e){ console.error(e); toast(mensajeError(e)); }
  await audit("ingreso", "");
  render();
}

async function salir(){
  await audit("salida", "");
  await sb.auth.signOut();   // el listener SIGNED_OUT limpia S.sesion y renderiza
  cerrarMenu();
}

/* ---------- contraseña olvidada ---------- */
function olvideContrasena(){
  abrirModal(`
    <h3>Recuperar contraseña</h3>
    <p class="q">Ingresa el correo de tu cuenta. Te enviaremos un enlace para definir una nueva contraseña.</p>
    <div class="fgrp"><span class="lab">Correo</span><input type="text" id="rpEmail" placeholder="tu@correo.cl"></div>
    <div id="rpMsg" class="authmsg"></div>
    <div class="mact"><button class="btn g" onclick="cerrarModal()">Cancelar</button>
    <button class="btn p" onclick="enviarRecuperacion()">Enviar enlace</button></div>`);
}
async function enviarRecuperacion(){
  const email = document.getElementById("rpEmail").value.trim();
  const msg = m => { const b = document.getElementById("rpMsg"); b.textContent = m; b.style.display = "block"; };
  if(!email) return msg("Ingresa tu correo.");
  const { error } = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.href.split("#")[0]});
  if(error) return msg(error.message);
  cerrarModal(); toast("Si el correo existe, llegará un enlace para restablecer la contraseña.");
}

/* pantalla que llega desde el enlace del correo (type=recovery) */
async function confirmarNuevaContrasena(){
  const p1 = document.getElementById("rcPass").value;
  const p2 = document.getElementById("rcPass2").value;
  const msg = m => { const b = document.getElementById("authMsg"); b.textContent = m; b.style.display = "block"; };
  if(p1.length < 6) return msg("La contraseña debe tener al menos 6 caracteres.");
  if(p1 !== p2) return msg("Las contraseñas no coinciden.");
  const { error } = await sb.auth.updateUser({password: p1});
  if(error) return msg(error.message);
  S.recuperando = false;
  toast("Contraseña actualizada.");
  const { data: {session} } = await sb.auth.getSession();
  if(session) await cargarSesionDesdePerfil(session.user);
  if(S.sesion){
    try{ await cargarEstado(); }catch(e){ console.error(e); toast(mensajeError(e)); }
    await audit("password_restablecido", "");
  }
  render();
}

/* ---------- cambiar contraseña estando ya logueado (Menú → Cambiar contraseña) ----------
   A diferencia de confirmarNuevaContrasena(), no depende del enlace de
   recuperación: la sesión activa ya es prueba suficiente de identidad
   (mismo criterio que usa Supabase Auth para permitir updateUser). */
async function guardarCambioContrasena(){
  const p1 = document.getElementById("cpPass1").value;
  const p2 = document.getElementById("cpPass2").value;
  const msg = m => { const b = document.getElementById("cpMsg"); b.textContent = m; b.style.display = "block"; };
  if(p1.length < 6) return msg("La contraseña debe tener al menos 6 caracteres.");
  if(p1 !== p2) return msg("Las contraseñas no coinciden.");

  const btn = document.getElementById("cpBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Guardando…"; }
  const { error } = await sb.auth.updateUser({password: p1});
  if(error){
    if(btn){ btn.disabled = false; btn.textContent = "Guardar"; }
    return msg(error.message);
  }
  await audit("password_cambiado", "");
  cerrarModal();
  toast("Contraseña actualizada.");
}
