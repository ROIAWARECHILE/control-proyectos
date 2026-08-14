// Edge Function: invitar-usuario
// Único punto del proyecto que usa la clave service_role (la gestiona Supabase
// automáticamente como variable de entorno; nunca vive en el cliente ni en el
// repo). Verifica que quien llama sea Jefatura y, si corresponde, envía la
// invitación real por correo (usa el envío de correo propio de Supabase Auth,
// el mismo que ya usan la confirmación de cuenta y "olvidé mi contraseña" —
// no hace falta ninguna cuenta ni clave de un proveedor externo).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Falta autenticación." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Cliente "como quien llama": respeta RLS, sirve solo para confirmar
  // identidad y rol — nunca se usa para escribir con privilegios de más.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sesión inválida." }, 401);

  const { data: perfil, error: perfilErr } = await callerClient
    .from("profiles").select("rol").eq("id", userData.user.id).single();
  if (perfilErr || perfil?.rol !== "jefatura") {
    return json({ error: "Solo Jefatura puede invitar usuarios." }, 403);
  }

  let body: { email?: string; nombre?: string; rol?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo de la solicitud inválido." }, 400);
  }
  const email = (body.email || "").trim();
  const nombre = (body.nombre || "").trim();
  const rol = body.rol === "jefatura" ? "jefatura" : "coordinador";
  if (!email || !nombre) return json({ error: "Falta el nombre o el correo." }, 400);

  // Recién acá se usa service_role: crea la cuenta y dispara el correo de
  // invitación de Supabase Auth (enlace para definir contraseña e ingresar).
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { nombre, rol },
  });
  if (inviteErr) return json({ error: inviteErr.message }, 400);

  // handle_new_user() (schema.sql) deja todo autorregistro como 'coordinador'
  // si ya existe una Jefatura, para que nadie se autoasigne el rol por fuera
  // de esta función. Como acá YA se verificó arriba que quien invita es
  // Jefatura, se corrige el rol con el mismo cliente de service_role.
  if (rol === "jefatura" && invited.user) {
    const { error: updErr } = await adminClient
      .from("profiles").update({ rol: "jefatura" }).eq("id", invited.user.id);
    if (updErr) {
      return json({ error: `Se invitó a ${email}, pero no se pudo dejarla como Jefatura: ${updErr.message}` }, 207);
    }
  }

  return json({ ok: true, userId: invited.user?.id ?? null });
});
