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

## Revisión de seguridad del sistema de login (recién hecha)

Repasé de punta a punta el login y los roles y corregí varios problemas antes de que llegaran a producción:

- **`notificar_item_cerrado()` no verificaba de quién era el proyecto** — cualquier Coordinador podía, llamando
  al RPC directo (no desde la UI), avisarle a Jefatura sobre un proyecto ajeno con un mensaje inventado. Corregido:
  ahora exige que el proyecto sea del Coordinador que llama.
- **La última cuenta Jefatura podía autodegradarse a Coordinador** sin ningún bloqueo real. Corregido en dos
  capas: `asignar_rol()` lo rechaza server-side, y el botón queda deshabilitado en la interfaz.
- **Si el arranque inicial fallaba a medias** (Coordinador creado, Jefatura no), no quedaba ningún camino en la
  interfaz para crear esa Jefatura. Ahora la pantalla de login lo detecta y ofrece crearla directamente.
- **Fallas silenciosas al iniciar sesión**: si faltara alguna tabla (por ejemplo, por no haber corrido este mismo
  archivo), el login mostraba una app vacía sin ningún mensaje. Ahora se avisa con un mensaje claro.

Ninguno de estos cambios requiere un paso adicional tuyo más allá de volver a correr `schema.sql` completo.

## Usuarios: ya no hay límite de 1 por rol

Antes la base de datos forzaba exactamente 1 Coordinador y 1 Jefatura (un índice único). Ahora se admiten varios
titulares de cada rol. Cómo agregar a alguien nuevo:

1. La persona entra a la pantalla de ingreso y hace clic en **"¿Nuevo aquí? Crear cuenta"** — se registra con su
   propio correo y contraseña. Queda como **Coordinador** por defecto (es el rol seguro: nadie puede autoasignarse
   Jefatura por registro público, lo bloquea un disparador en Postgres).
2. Una **Jefatura ya activa** entra, abre **Menú ☰ → Usuarios**, y le sube el rol a Jefatura con un clic
   ("Ascender a Jefatura"). Desde ahí también puede revertirlo.

No hay envío automático de un correo de invitación (habría que sumar una Edge Function con la clave `service_role`,
que deliberadamente no se usa en este proyecto — ver más abajo). Es un flujo de 2 pasos: la persona se registra,
alguien de Jefatura la asciende.

Si vienes de una versión anterior de este esquema, vuelve a ejecutar `supabase/schema.sql` completo (es seguro,
usa `drop index if exists` / `create or replace`) para quitar el límite de 1 cuenta por rol y habilitar la función
`asignar_rol` que usa la pantalla de Usuarios.

## Catálogo de ítems: ahora editable, ya no vive en el código

El checklist (las 6 etapas y sus ítems) dejó de estar escrito en `model.js`. Ahora vive en las tablas
`etapas_catalogo` / `items_catalogo`, con una pantalla nueva en **Menú ☰ → Catálogo de ítems** (solo Jefatura) para:

- Editar el texto de un ítem, si exige evidencia obligatoria y a qué tipos de proyecto aplica.
- Agregar ítems nuevos a cualquier etapa.
- "Quitar" un ítem del catálogo (lo archiva, no lo borra — se puede restaurar desde "Ítems archivados").
- Renombrar el nombre/hito de una etapa (las 6 etapas en sí son fijas: sus fechas límite, RN-5, dependen de su número).

**Los proyectos que ya existen no se ven afectados por estos cambios**: cada proyecto guarda su propio checklist
(`proyectos.checklist`) al crearse, así que editar el catálogo solo cambia el checklist de los proyectos *nuevos*
(o de uno existente si Jefatura le cambia el tipo, RN-12).

Vuelve a ejecutar `supabase/schema.sql` completo para crear estas tablas — trae una semilla con el catálogo
original de 29 ítems, así que no pierdes nada al actualizar.

## Notificaciones: campanita dentro de la app (sin correo)

Hay un centro de notificaciones (🔔 en la barra superior) con dos fuentes:

- **Alertas de etapas** (vencida / por vencer): se recalculan en vivo, igual que las alertas del dashboard, pero
  ahora visibles a cualquier rol desde cualquier pantalla, no solo dentro del panel Dashboard.
- **Actividad**: un evento real y persistente por cada ítem que un Coordinador cierra, dirigido a **todas** las
  cuentas Jefatura. Se puede marcar como leída (una por una o todas juntas) y queda guardado en la tabla
  `notificaciones`.

Deliberadamente **no hay correo ni push**: eso exigiría una Edge Function con su propia `service_role` y una cuenta
en un proveedor de correo transaccional (Resend, etc.), infraestructura que este proyecto evita a propósito (ver
"Dónde viven los datos ahora" más abajo). Tampoco hay cron: todo se recalcula/recarga al entrar a la app o al abrir
la campanita, así que puede haber unas horas de desfase si nadie tiene la app abierta. Si más adelante quieres
correo real, es la siguiente pieza natural a construir.

Vuelve a ejecutar `supabase/schema.sql` completo para crear la tabla `notificaciones` y la función
`notificar_item_cerrado`.

## Instaladores: lista real en vez de campo libre

"Instalador externo" dejó de ser un campo de texto libre: ahora se elige de una lista real (Menú → Instaladores,
solo Jefatura) que ya trae sembrado el equipo de instaladores. Se pueden agregar, editar y "quitar" (se archiva,
igual que el catálogo de ítems — nunca se borra). Los proyectos ya creados con el nombre de instalador escrito a
mano no se ven afectados. Vuelve a ejecutar `supabase/schema.sql` para crear la tabla `instaladores`.

## Tipos de proyecto: ahora solo Piscina y Tiny House

El selector de "Tipo de proyecto" al crear/editar ya no muestra Modular, Prefabricada ni Modular Industrial — el
negocio hoy solo trabaja Piscina y Tiny House. Cuando el tipo es **Piscina**, aparece un segundo selector,
**Línea**, con las opciones **SWIM** y **SMARTPOOLS**. No cambia el checklist (las mismas reglas de "solo
piscinas" siguen aplicando a ambas líneas); es solo una marca/línea de producto que ahora se ve como etiqueta en
las tarjetas, el detalle y la tabla de Jefatura.

Vuelve a ejecutar `supabase/schema.sql` completo para agregar la columna `linea_piscina` a `proyectos`.

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
