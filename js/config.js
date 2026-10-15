/* =====================================================================
   CONFIGURACIÓN DEL PROYECTO SUPABASE
   La clave pública (anon/publishable) está diseñada para ir en el
   cliente: por sí sola no da acceso a nada, todo lo controla RLS
   (ver supabase/schema.sql). Nunca pongas aquí la clave "service_role".
   ===================================================================== */
const SUPABASE_URL = "https://isbpfyeoilznnnywcxhx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tAabqx6C574v8-1ZD2_Jmw_Y6WUB7DP";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
