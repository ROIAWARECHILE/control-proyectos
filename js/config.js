/* =====================================================================
   CONFIGURACIÓN DEL PROYECTO SUPABASE
   La clave pública (anon/publishable) está diseñada para ir en el
   cliente: por sí sola no da acceso a nada, todo lo controla RLS
   (ver supabase/schema.sql). Nunca pongas aquí la clave "service_role".
   ===================================================================== */
const SUPABASE_URL = "https://djgrqunkbrppcqhfelyi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqZ3JxdW5rYnJwcGNxaGZlbHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYxMjg1NzgsImV4cCI6MjA3MTcwNDU3OH0.J3PyFqZ8-kAonplvQuapg8vg0IIQwiKVd7yEuVVqrfw";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
