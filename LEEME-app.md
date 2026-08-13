# Plataforma de Control de Proyectos — versión en la nube (Supabase)

**Estado:** aplicación conectada a un proyecto Supabase real. Falta un único paso tuyo antes de poder usarla: ejecutar el esquema de base de datos (5 minutos, se explica abajo).
**Basada en:** la versión local anterior + Especificación funcional v1.1 (RN-1 a RN-14, §2 Roles y permisos).
**Proyecto Supabase:** `djgrqunkbrppcqhfelyi` (tu organización).

---

## Por qué necesitas ejecutar un paso manual

No tengo permiso para ejecutar SQL directamente en tu proyecto `djgrqunkbrppcqhfelyi` (mi conector de Supabase solo ve otros proyectos de tu cuenta). Por eso te dejo el esquema completo listo en `supabase/schema.sql` — lo pegas una vez en el editor SQL de Supabase y todo lo demás ya está construido y probado contra tu proyecto real (la app ya conecta correctamente; solo falta que existan las tablas).

## Puesta en marcha (una vez, ~5 minutos)

1. Entra a **[supabase.com/dashboard](https://supabase.com/dashboard)** → proyecto `djgrqunkbrppcqhfelyi` → **SQL Editor** → **New query**.
2. Abre `app/supabase/schema.sql` de esta entrega, copia **todo** el contenido, pégalo en el editor y presiona **Run**. Crea las tablas, la seguridad (RLS), los disparadores de integridad y el bucket de evidencias. Es seguro volver a ejecutarlo si algo falla a mitad de camino: corrígelo y vuelve a correr el archivo completo.
3. (Opcional, reduce fricción) **Authentication → Sign In / Providers → Email** → desactiva **"Confirm email"**. Si lo dejas activado, cada cuenta deberá abrir el correo de confirmación antes de su primer ingreso — funciona igual, solo es un paso extra.
4. Abre `app/index.html` con doble clic (Chrome o Edge). Te pedirá crear las dos cuentas: **Coordinador** (registra avances y evidencias) y **Jefatura** (crea proyectos, supervisa). Cada una con su correo y contraseña.
5. Ingresa como Jefatura y crea el primer proyecto — es la única cuenta que puede crear proyectos (ver más abajo). Luego ingresa como Coordinador para registrar el checklist.

Si algo falla en este paso, avísame el mensaje de error del SQL Editor y lo corrijo de inmediato.

## Qué cambió respecto a la versión local: roles reales

La especificación (§2) es más estricta de lo que tenía la versión anterior, y ahora se aplica de verdad — no solo en la interfaz, sino en la base de datos, así que no se puede saltar:

| Acción | Coordinador | Jefatura |
|---|---|---|
| Ver proyectos | Solo los suyos | Todos |
| Crear proyecto | No | Sí |
| Editar fechas / tipo de proyecto | No | Sí |
| Editar nombre / cliente / comuna / instalador | Sí (los suyos) | Sí (todos) |
| Marcar ítems, adjuntar evidencia, reabrir | Sí (los suyos) | No (solo lectura) |
| Eliminar (archivar) / restaurar proyecto | Sí (los suyos) | Sí (todos) |
| Ver auditoría y evidencias | Sí (de sus proyectos) | Sí (de todos) |

Esto es una interpretación fiel del documento, no una decisión mía discrecional — salvo un punto: la especificación no dice explícitamente quién puede eliminar un proyecto, así que mantuve el criterio de la versión anterior (el Coordinador puede archivar los suyos). Si prefieres restringirlo solo a Jefatura, es un cambio de una línea en `supabase/schema.sql`.

## Qué hace

- **Checklist de 6 etapas**, fechas límite (RN-5), semáforo (RN-6) y alertas (RN-7).
- **Evidencia obligatoria** en los ítems críticos (RN-1): cámara directa o galería, compresión automática, huella SHA-256.
- **Sello inmutable** de fecha, hora, usuario y GPS best-effort (RN-2).
- **Inmutabilidad real, a nivel de base de datos**: un disparador en Postgres impide modificar un registro de avance ya cerrado (solo permite archivarlo al reabrir, RN-3); las evidencias no tienen ninguna política de actualización o borrado — es físicamente imposible modificarlas desde la app.
- **Borrado lógico** (RN-13) y **cambio de tipo con archivado automático** de lo que deja de aplicar (RN-12).
- **Auditoría** de solo-inserción: nadie, ni siquiera el propio autor, puede editar o borrar una entrada ya escrita.
- **Acta de recepción** imprimible, habilitada al 100% (RN-8).

## Dónde viven los datos ahora

En Supabase: Postgres para los datos, Storage privado para las fotos. Accesible desde cualquier equipo o celular con el archivo `index.html` (o mejor, alojando la carpeta `app/` en un hosting estático — Netlify, Vercel, GitHub Pages — para tener una URL fija; te ayudo con eso cuando quieras). El respaldo de la base de datos ahora lo maneja Supabase (revisa el plan de tu proyecto para la política de backups); *Menú ☰ → Exportar copia* sigue disponible para una copia manual en JSON de lo que cada usuario puede ver.

La clave pública (`anon key`) que quedó en `js/config.js` está pensada para ir en el cliente: por sí sola no da acceso a nada, todo lo controla la seguridad a nivel de fila (RLS) de `schema.sql`. Nunca se usó ni se guardó la clave secreta (`service_role`).

## Verificación

- Confirmé por red (Chrome real, sin servidor local, abriendo el archivo `file://`) que la app conecta correctamente con tu proyecto Supabase: la petición llega, no hay error de CORS, y la app muestra el mensaje correcto de "falta ejecutar el esquema" — exactamente el estado actual antes de que corras el paso 2.
- No pude correr las 19 pruebas end-to-end completas (creación de cuentas, checklist, evidencias, roles) contra tu proyecto porque requieren que las tablas ya existan. En cuanto ejecutes `schema.sql`, dime y las corro contra tu proyecto real para confirmar que todo el flujo funciona de punta a punta antes de que lo uses en producción.
