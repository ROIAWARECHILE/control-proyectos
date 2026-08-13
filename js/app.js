/* =====================================================================
   ARRANQUE
   ===================================================================== */

document.getElementById("ov").onclick = e => { if(e.target.id === "ov") cerrarModal(); };
document.addEventListener("click", e => {
  const menu = document.getElementById("menu");
  if(menu && menu.classList.contains("on") && !menu.contains(e.target)) cerrarMenu();
});
document.addEventListener("keydown", e => { if(e.key === "Escape"){ cerrarModal(); cerrarMenu(); } });

(async function init(){
  conectarEntradasArchivo();
  conectarCambiosAuth();
  render();   // pantalla en blanco breve mientras se resuelve el estado inicial

  try{
    S.hayCuentas = await existenCuentas();
  }catch(err){
    console.error(err);
    document.getElementById("app").innerHTML = `
      <div class="card empty" style="margin-top:40px">
        <b>No se pudo conectar con el servidor.</b><br><br>
        Verifica tu conexión a internet. Si el problema persiste, es probable que el esquema de la base de datos
        (<code>supabase/schema.sql</code>) aún no se haya ejecutado en el proyecto de Supabase.<br>
        <span style="color:var(--muted);font-size:12.5px">${esc(err && err.message || err)}</span>
      </div>`;
    return;
  }

  if(S.hayCuentas){
    try{ await restaurarSesion(); }catch(e){ console.error(e); }
    if(S.sesion){ try{ await cargarEstado(); }catch(e){ console.error(e); toast(mensajeError(e)); } }
  }
  render();
})();
