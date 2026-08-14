-- =====================================================================
-- Plataforma de Control de Proyectos — esquema Supabase
-- Ejecutar UNA VEZ en: Dashboard del proyecto -> SQL Editor -> New query
-- -> pegar todo este archivo -> Run.
-- Es seguro volver a ejecutarlo (usa IF NOT EXISTS / OR REPLACE / DROP...CREATE).
-- Reglas de negocio referenciadas: Especificación funcional v1.1 (RN-1 a RN-14, §2).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PERFILES (roles de la app sobre auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('coordinador','jefatura')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ya no se limita a 1 titular por rol: ahora se admiten varios Coordinadores
-- y varias Jefaturas. Si tu proyecto viene de una versión anterior con el
-- índice antiguo, esto lo elimina.
drop index if exists public.profiles_rol_unico;

-- Crea el perfil automáticamente cuando alguien se registra (signUp).
-- Seguridad: el rol que llega en los metadatos del registro (raw_user_meta_data)
-- lo controla quien se registra, así que NO se confía en él para el rol
-- sensible 'jefatura' salvo en el arranque en blanco (para poder crear la
-- primera cuenta de Jefatura desde la configuración inicial). Una vez existe
-- al menos una Jefatura, cualquier cuenta nueva creada por autorregistro
-- queda como 'coordinador'; una Jefatura ya existente la asciende después
-- con public.asignar_rol().
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Cualquier valor que no sea exactamente 'jefatura' cae a 'coordinador'
  -- (incluye null y cualquier texto arbitrario que alguien mande a mano
  -- fuera de la UI) — evita que un metadato inválido tumbe el registro
  -- entero con un error crudo del check de profiles.rol.
  rol_solicitado text := case when new.raw_user_meta_data->>'rol' = 'jefatura' then 'jefatura' else 'coordinador' end;
  rol_final text;
begin
  if rol_solicitado = 'jefatura' and exists(select 1 from public.profiles where rol = 'jefatura') then
    rol_final := 'coordinador';
  else
    rol_final := rol_solicitado;
  end if;
  insert into public.profiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), rol_final);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rol del usuario autenticado (security definer: evita recursión de RLS)
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.profiles where id = auth.uid();
$$;

-- Permite a la pantalla de ingreso saber si ya existen cuentas, SIN
-- exponer nombres/roles a usuarios no autenticados (solo un booleano).
create or replace function public.existen_cuentas()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles);
$$;
grant execute on function public.existen_cuentas() to anon, authenticated;

-- Igual que existen_cuentas(), pero específico para Jefatura: le permite a
-- la pantalla de ingreso ofrecer "crear la primera cuenta Jefatura" si la
-- configuración inicial se interrumpió (coordinador creado, jefatura no) y
-- no quedó ningún camino en la interfaz para crearla (asignar_rol exige ya
-- estar logueado como Jefatura). Deja de ser necesario en cuanto exista una.
create or replace function public.existe_jefatura()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where rol = 'jefatura');
$$;
grant execute on function public.existe_jefatura() to anon, authenticated;

-- Cambia el rol de un usuario existente. Solo Jefatura puede llamarla
-- (verificado server-side, no solo en la interfaz): es el mecanismo para
-- "invitar" a alguien como Jefatura sin exponer un endpoint de autorregistro
-- que cualquiera pueda usar para autoasignarse el rol.
-- Nunca deja el sistema en cero Jefaturas: eso reabriría, para cualquier
-- autorregistro público, la ventana de arranque que handle_new_user() usa
-- para crear la primera cuenta de Jefatura (rol_solicitado='jefatura'
-- permitido solo mientras no exista ninguna) — sin esta protección,
-- vaciar la última Jefatura sería una vía para que cualquiera se
-- autoasigne el rol registrándose justo después.
create or replace function public.asignar_rol(usuario_id uuid, nuevo_rol text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'jefatura' then
    raise exception 'Solo Jefatura puede cambiar el rol de un usuario.';
  end if;
  if nuevo_rol not in ('coordinador','jefatura') then
    raise exception 'Rol inválido: %', nuevo_rol;
  end if;
  if nuevo_rol <> 'jefatura'
     and exists(select 1 from public.profiles where id = usuario_id and rol = 'jefatura')
     and (select count(*) from public.profiles where rol = 'jefatura') <= 1 then
    raise exception 'No puedes quitarle el rol de Jefatura a la última cuenta que lo tiene.';
  end if;
  update public.profiles set rol = nuevo_rol where id = usuario_id;
end;
$$;
grant execute on function public.asignar_rol(uuid, text) to authenticated;

alter table public.profiles enable row level security;
drop policy if exists "perfiles: lectura de usuarios autenticados" on public.profiles;
create policy "perfiles: lectura de usuarios autenticados"
  on public.profiles for select to authenticated using (true);
-- Sin insert/update/delete desde el cliente: el perfil lo crea el trigger.

-- ---------------------------------------------------------------------
-- 2. PROYECTOS
-- ---------------------------------------------------------------------
create sequence if not exists public.proyecto_seq start 2050;

create table if not exists public.proyectos (
  id text primary key default ('P-' || nextval('public.proyecto_seq')),
  nombre text not null,
  cliente text not null default 'Por definir',
  -- 'Modular'/'Prefabricada'/'Modular Industrial' quedaron fuera de la UI (ver TIPOS en model.js),
  -- pero se dejan como valores válidos aquí para no romper proyectos ya creados con esos tipos.
  tipo text not null check (tipo in ('Piscina','Modular','Prefabricada','Modular Industrial','Tiny House')),
  comuna text not null default '—',
  coordinador_id uuid references public.profiles(id),
  instalador text not null default 'Por asignar',
  fecha_inicio date not null,
  fecha_termino date not null,
  checklist jsonb not null,
  archivado boolean not null default false,
  archivado_ts timestamptz,
  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fechas_validas check (fecha_termino >= fecha_inicio)
);

-- Línea de producto, solo para tipo='Piscina' (SWIM / SMARTPOOLS). Es un
-- campo aparte del tipo a propósito: no cambia qué ítems del catálogo
-- aplican (aplica_tipos sigue mirando "Piscina"), solo describe la marca.
alter table public.proyectos add column if not exists linea_piscina text;
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'linea_piscina_valores' and table_name = 'proyectos'
  ) then
    alter table public.proyectos
      add constraint linea_piscina_valores check (linea_piscina is null or linea_piscina in ('SWIM','SMARTPOOLS'));
  end if;
end $$;

-- RN-4/RN-12: el Coordinador no puede editar fechas, tipo, línea de piscina
-- ni reasignar el proyecto (§2). Solo Jefatura puede. El checklist se
-- recalcula server-side si cambia el tipo (ver función siguiente); aquí
-- solo se protege el campo.
create or replace function public.proyecto_restringir_edicion()
returns trigger language plpgsql as $$
begin
  if public.mi_rol() <> 'jefatura' then
    if new.fecha_inicio is distinct from old.fecha_inicio
       or new.fecha_termino is distinct from old.fecha_termino
       or new.tipo is distinct from old.tipo
       or new.linea_piscina is distinct from old.linea_piscina
       or new.checklist is distinct from old.checklist
       or new.coordinador_id is distinct from old.coordinador_id then
      raise exception 'El Coordinador no puede editar fechas, tipo o coordinador asignado (Especificación §2).';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_proyecto_restringir on public.proyectos;
create trigger trg_proyecto_restringir
  before update on public.proyectos
  for each row execute function public.proyecto_restringir_edicion();

alter table public.proyectos enable row level security;
drop policy if exists "proyectos: ver propios o todos si jefatura" on public.proyectos;
create policy "proyectos: ver propios o todos si jefatura"
  on public.proyectos for select to authenticated
  using (public.mi_rol() = 'jefatura' or coordinador_id = auth.uid());

drop policy if exists "proyectos: crear solo jefatura" on public.proyectos;
create policy "proyectos: crear solo jefatura"
  on public.proyectos for insert to authenticated
  with check (public.mi_rol() = 'jefatura');

drop policy if exists "proyectos: editar propios o todos si jefatura" on public.proyectos;
create policy "proyectos: editar propios o todos si jefatura"
  on public.proyectos for update to authenticated
  using (public.mi_rol() = 'jefatura' or coordinador_id = auth.uid())
  with check (public.mi_rol() = 'jefatura' or coordinador_id = auth.uid());
-- Sin policy de delete: el borrado es lógico (RN-13), vía update de "archivado".

-- ---------------------------------------------------------------------
-- 3. AVANCE DE ÍTEMS (checklist) — historial inmutable (RN-3)
--    (la referencia a evidencias se agrega después de crear esa tabla, más abajo)
-- ---------------------------------------------------------------------
create table if not exists public.item_avance (
  id uuid primary key default gen_random_uuid(),
  proyecto_id text not null references public.proyectos(id) on delete cascade,
  item_id text not null,
  ok boolean not null default true,
  ts timestamptz not null default now(),
  usuario_id uuid references public.profiles(id),
  usuario_nombre text not null,
  nota text not null default '',
  evidencia_id uuid,
  geo_lat numeric,
  geo_lng numeric,
  con_etapas_previas_incompletas boolean not null default false,
  vigente boolean not null default true,
  archivado_ts timestamptz,
  motivo text
);
create index if not exists item_avance_proyecto_idx on public.item_avance(proyecto_id);
-- Solo puede existir un registro VIGENTE por ítem de un proyecto:
create unique index if not exists item_avance_vigente_unico
  on public.item_avance(proyecto_id, item_id) where vigente;

-- RN-3: inmutable salvo la transición vigente(true -> false) al reabrir.
create or replace function public.avance_solo_archivar()
returns trigger language plpgsql as $$
begin
  if old.vigente = false then
    raise exception 'Este registro ya fue archivado y no puede modificarse (RN-3).';
  end if;
  if new.vigente = true then
    raise exception 'No se puede reactivar un registro archivado; se crea uno nuevo al volver a cerrar el ítem (RN-3).';
  end if;
  if new.ok is distinct from old.ok or new.ts is distinct from old.ts
     or new.usuario_id is distinct from old.usuario_id or new.usuario_nombre is distinct from old.usuario_nombre
     or new.nota is distinct from old.nota or new.evidencia_id is distinct from old.evidencia_id
     or new.proyecto_id is distinct from old.proyecto_id or new.item_id is distinct from old.item_id then
    raise exception 'El registro de avance es inmutable salvo su archivado (RN-3).';
  end if;
  new.archivado_ts := coalesce(new.archivado_ts, now());
  return new;
end;
$$;
drop trigger if exists trg_avance_solo_archivar on public.item_avance;
create trigger trg_avance_solo_archivar
  before update on public.item_avance
  for each row execute function public.avance_solo_archivar();

alter table public.item_avance enable row level security;
drop policy if exists "avance: ver segun proyecto" on public.item_avance;
create policy "avance: ver segun proyecto"
  on public.item_avance for select to authenticated
  using (exists (select 1 from public.proyectos pr where pr.id = item_avance.proyecto_id
                 and (public.mi_rol() = 'jefatura' or pr.coordinador_id = auth.uid())));

drop policy if exists "avance: coordinador registra en su proyecto" on public.item_avance;
create policy "avance: coordinador registra en su proyecto"
  on public.item_avance for insert to authenticated
  with check (public.mi_rol() = 'coordinador' and usuario_id = auth.uid()
              and exists (select 1 from public.proyectos pr where pr.id = proyecto_id and pr.coordinador_id = auth.uid()));

drop policy if exists "avance: coordinador archiva en su proyecto" on public.item_avance;
create policy "avance: coordinador archiva en su proyecto"
  on public.item_avance for update to authenticated
  using (public.mi_rol() = 'coordinador'
         and exists (select 1 from public.proyectos pr where pr.id = item_avance.proyecto_id and pr.coordinador_id = auth.uid()));
-- Sin policy de delete: nunca se borra (RN-3).

-- ---------------------------------------------------------------------
-- 4. EVIDENCIAS — metadatos (archivo real en Storage). 100% inmutable.
-- ---------------------------------------------------------------------
create table if not exists public.evidencias (
  id uuid primary key default gen_random_uuid(),
  proyecto_id text not null references public.proyectos(id) on delete cascade,
  item_id text not null,
  storage_path text not null,
  mime text,
  hash_sha256 text,
  ts timestamptz not null default now(),
  usuario_id uuid references public.profiles(id),
  usuario_nombre text not null
);
create index if not exists evidencias_proyecto_idx on public.evidencias(proyecto_id);

-- Ahora que existe evidencias, se completa la referencia desde item_avance
-- (sin ON DELETE: una evidencia referenciada no puede borrarse, RN-3).
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'item_avance_evidencia_id_fkey' and table_name = 'item_avance'
  ) then
    alter table public.item_avance
      add constraint item_avance_evidencia_id_fkey foreign key (evidencia_id) references public.evidencias(id);
  end if;
end $$;

alter table public.evidencias enable row level security;
drop policy if exists "evidencias: ver segun proyecto" on public.evidencias;
create policy "evidencias: ver segun proyecto"
  on public.evidencias for select to authenticated
  using (exists (select 1 from public.proyectos pr where pr.id = evidencias.proyecto_id
                 and (public.mi_rol() = 'jefatura' or pr.coordinador_id = auth.uid())));

drop policy if exists "evidencias: coordinador carga en su proyecto" on public.evidencias;
create policy "evidencias: coordinador carga en su proyecto"
  on public.evidencias for insert to authenticated
  with check (public.mi_rol() = 'coordinador' and usuario_id = auth.uid()
              and exists (select 1 from public.proyectos pr where pr.id = proyecto_id and pr.coordinador_id = auth.uid()));
-- Sin policy de update/delete: la evidencia jamás se modifica ni se borra (RN-3).

-- ---------------------------------------------------------------------
-- 5. AUDITORÍA — bitácora de solo-inserción
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  proyecto_id text references public.proyectos(id) on delete set null,
  usuario_id uuid references public.profiles(id),
  usuario_nombre text not null,
  rol text,
  accion text not null,
  detalle text not null default '',
  ts timestamptz not null default now()
);
create index if not exists auditoria_proyecto_idx on public.auditoria(proyecto_id);

alter table public.auditoria enable row level security;
drop policy if exists "auditoria: lectura de usuarios autenticados" on public.auditoria;
create policy "auditoria: lectura de usuarios autenticados"
  on public.auditoria for select to authenticated using (true);

drop policy if exists "auditoria: cada quien registra sus propias acciones" on public.auditoria;
create policy "auditoria: cada quien registra sus propias acciones"
  on public.auditoria for insert to authenticated
  with check (usuario_id = auth.uid());
-- Sin policy de update/delete: bitácora de solo-inserción.

-- ---------------------------------------------------------------------
-- 6. STORAGE — bucket privado de evidencias
--    ruta de cada archivo: {proyecto_id}/{item_id}/{uuid}.jpg
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do nothing;

drop policy if exists "evidencias-storage: coordinador sube a su proyecto" on storage.objects;
create policy "evidencias-storage: coordinador sube a su proyecto"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and public.mi_rol() = 'coordinador'
    and exists (select 1 from public.proyectos pr
                where pr.id = (storage.foldername(name))[1] and pr.coordinador_id = auth.uid())
  );

drop policy if exists "evidencias-storage: ver segun proyecto" on storage.objects;
create policy "evidencias-storage: ver segun proyecto"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidencias'
    and exists (select 1 from public.proyectos pr
                where pr.id = (storage.foldername(name))[1]
                and (public.mi_rol() = 'jefatura' or pr.coordinador_id = auth.uid()))
  );
-- Sin policy de update/delete sobre el bucket: los archivos son inmutables (RN-3).

-- ---------------------------------------------------------------------
-- 7. CATÁLOGO DE ÍTEMS (checklist editable desde la plataforma, sin
--    depender de un desarrollador). Los proyectos ya creados NO se ven
--    afectados por ediciones futuras: cada uno guarda su propio snapshot
--    en proyectos.checklist al crearse o al cambiar de tipo (RN-12). Este
--    catálogo solo alimenta el snapshot de proyectos NUEVOS.
-- ---------------------------------------------------------------------
create table if not exists public.etapas_catalogo (
  n smallint primary key check (n between 1 and 6),
  nombre text not null,
  hito text not null
);
-- Las 6 etapas son fijas: RN-5 ancla la fórmula de fecha límite a su
-- número, así que no se admite crear ni borrar etapas, solo renombrarlas.

create table if not exists public.items_catalogo (
  id text primary key,
  etapa_n smallint not null references public.etapas_catalogo(n),
  texto text not null,
  evidencia text not null check (evidencia in ('obligatoria','opcional')),
  aplica_tipos text[] not null default '{}',   -- vacío = todos los tipos de proyecto
  orden integer not null default 0,
  activo boolean not null default true,        -- "quitar del catálogo" archiva, nunca borra (mismo criterio que el resto del esquema)
  created_at timestamptz not null default now()
);
create index if not exists items_catalogo_etapa_idx on public.items_catalogo(etapa_n, orden);

-- Semilla: el catálogo original (idéntico al que traía model.js). No pisa
-- ediciones ya hechas por Jefatura si vuelves a correr este archivo.
insert into public.etapas_catalogo (n, nombre, hito) values
  (1, 'Cinco días antes del inicio', 'T-5 días'),
  (2, 'Un día antes del inicio', 'T-1 día'),
  (3, 'Inicio del proyecto', 'Día 1'),
  (4, 'Durante el proyecto', 'Ejecución'),
  (5, 'Término del proyecto (con instalador)', 'Cierre técnico'),
  (6, 'Entrega del proyecto (con cliente)', 'Recepción')
on conflict (n) do nothing;

insert into public.items_catalogo (id, etapa_n, texto, evidencia, aplica_tipos, orden) values
  ('1.1', 1, 'Validar correcta creación de Grupo WhatsApp con Cliente y Equipo Interno', 'opcional', '{}', 1),
  ('1.2', 1, 'Validar entrega de Información General en el grupo WhatsApp', 'opcional', '{}', 2),
  ('1.3', 1, 'Validar inspección digital del terreno', 'opcional', '{}', 3),
  ('1.4', 1, 'Confirmación e información de instaladores externos', 'opcional', '{}', 4),
  ('2.1', 2, 'Confirmación de información de colaboradores externos (retro, áridos, pluma, otros)', 'opcional', '{}', 1),
  ('2.2', 2, 'Llamado Día 0 al cliente (previo al inicio de actividades del Día 1)', 'obligatoria', '{}', 2),
  ('2.3', 2, 'Verificar entrega de cuentas de externos', 'opcional', '{}', 3),
  ('2.4', 2, 'Firma digital del cliente para el inicio de actividades (documento tipo)', 'obligatoria', '{}', 4),
  ('3.1', 3, 'Validar lay-out: ubicación de montaje, orientación, alineación, deslindes, niveles y ubicación de equipos', 'obligatoria', '{}', 1),
  ('3.2', 3, 'Validar zona de acopio de material o escombro y accesos para maquinaria', 'obligatoria', '{}', 2),
  ('4.1', 4, 'Informar primer avance del proyecto', 'obligatoria', '{}', 1),
  ('4.2', 4, 'Informar segundo avance del proyecto', 'obligatoria', '{}', 2),
  ('4.3', 4, 'Informar tercer avance del proyecto', 'obligatoria', '{}', 3),
  ('4.4', 4, 'Informar la entrega del proyecto', 'obligatoria', '{}', 4),
  ('5.1', 5, 'Verificar nivelación final del montaje', 'obligatoria', '{}', 1),
  ('5.2', 5, 'Verificar rellenos perimetrales y escala', 'obligatoria', '{}', 2),
  ('5.3', 5, 'Verificar montaje de equipos', 'obligatoria', '{Piscina}', 3),
  ('5.4', 5, 'Verificar montaje de tensores', 'obligatoria', '{Piscina}', 4),
  ('5.5', 5, 'Revisión eléctrica general', 'obligatoria', '{}', 5),
  ('5.6', 5, 'Verificación de conexión de neutro, fase y tierra del tablero programador', 'obligatoria', '{Piscina}', 6),
  ('5.7', 5, 'Verificación de conexión de neutro, fase y tierra de la alimentación eléctrica de la propiedad del cliente', 'obligatoria', '{}', 7),
  ('5.8', 5, 'Verificación de funcionamiento del sistema base: tablero programador, bomba y filtro', 'obligatoria', '{Piscina}', 8),
  ('5.9', 5, 'Verificación de funcionamiento de adicionales, si aplican: clorador, ionizador, bomba de calor, cascada, otros', 'opcional', '{Piscina}', 9),
  ('5.10', 5, 'Verificar ausencia de filtraciones', 'obligatoria', '{Piscina}', 10),
  ('5.11', 5, 'Verificar presión de trabajo del sistema', 'obligatoria', '{Piscina}', 11),
  ('6.1', 6, 'Capacitación al cliente por parte del líder de terreno', 'obligatoria', '{}', 1),
  ('6.2', 6, 'Entrega de manuales y garantías', 'obligatoria', '{}', 2),
  ('6.3', 6, 'Validar orden y limpieza del área de trabajo', 'obligatoria', '{}', 3),
  ('6.4', 6, 'Obtener recepción conforme del cliente', 'obligatoria', '{}', 4)
on conflict (id) do nothing;

alter table public.etapas_catalogo enable row level security;
drop policy if exists "catalogo etapas: lectura autenticados" on public.etapas_catalogo;
create policy "catalogo etapas: lectura autenticados"
  on public.etapas_catalogo for select to authenticated using (true);
drop policy if exists "catalogo etapas: edita jefatura" on public.etapas_catalogo;
create policy "catalogo etapas: edita jefatura"
  on public.etapas_catalogo for update to authenticated
  using (public.mi_rol() = 'jefatura') with check (public.mi_rol() = 'jefatura');
-- Sin insert/delete: las 6 etapas son fijas (ver arriba).

alter table public.items_catalogo enable row level security;
drop policy if exists "catalogo items: lectura autenticados" on public.items_catalogo;
create policy "catalogo items: lectura autenticados"
  on public.items_catalogo for select to authenticated using (true);
drop policy if exists "catalogo items: jefatura inserta" on public.items_catalogo;
create policy "catalogo items: jefatura inserta"
  on public.items_catalogo for insert to authenticated
  with check (public.mi_rol() = 'jefatura');
drop policy if exists "catalogo items: jefatura edita" on public.items_catalogo;
create policy "catalogo items: jefatura edita"
  on public.items_catalogo for update to authenticated
  using (public.mi_rol() = 'jefatura') with check (public.mi_rol() = 'jefatura');
-- Sin policy de delete: "quitar" un ítem es archivarlo (activo=false), nunca borrarlo.

-- ---------------------------------------------------------------------
-- 8. NOTIFICACIONES — centro de notificaciones dentro de la app.
--    Sin correo ni push (decisión deliberada: sin service_role ni Edge
--    Functions en este proyecto). Se recalculan/recargan al entrar a la
--    app o al abrir la campanita, no hay cron ni tiempo real.
-- ---------------------------------------------------------------------
create table if not exists public.notificaciones (
  id bigint generated always as identity primary key,
  destinatario_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null,                     -- por ahora solo 'item_cerrado'
  proyecto_id text references public.proyectos(id) on delete cascade,
  mensaje text not null,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notificaciones_destinatario_idx on public.notificaciones(destinatario_id, created_at desc);

-- Único punto de entrada para crear notificaciones: nunca se insertan
-- directo desde el cliente (así no hay que confiar en qué destinatario_id
-- mande el navegador). Avisa a TODAS las cuentas Jefatura, sean cuantas
-- sean, cuando un Coordinador cierra un ítem de UN PROYECTO PROPIO — sin
-- esta verificación, cualquier Coordinador podría invocar el RPC directo
-- (sin pasar por la UI) con el proyecto_id de otro y un mensaje inventado.
create or replace function public.notificar_item_cerrado(p_proyecto_id text, p_mensaje text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'coordinador' then
    return;
  end if;
  if not exists (
    select 1 from public.proyectos where id = p_proyecto_id and coordinador_id = auth.uid()
  ) then
    return;
  end if;
  insert into public.notificaciones (destinatario_id, tipo, proyecto_id, mensaje)
  select id, 'item_cerrado', p_proyecto_id, p_mensaje from public.profiles where rol = 'jefatura';
end;
$$;
grant execute on function public.notificar_item_cerrado(text, text) to authenticated;

alter table public.notificaciones enable row level security;
drop policy if exists "notificaciones: cada quien ve las suyas" on public.notificaciones;
create policy "notificaciones: cada quien ve las suyas"
  on public.notificaciones for select to authenticated using (destinatario_id = auth.uid());
drop policy if exists "notificaciones: cada quien marca las suyas como leidas" on public.notificaciones;
create policy "notificaciones: cada quien marca las suyas como leidas"
  on public.notificaciones for update to authenticated
  using (destinatario_id = auth.uid()) with check (destinatario_id = auth.uid());
-- Sin policy de insert/delete desde el cliente: se crean solo vía notificar_item_cerrado() (security definer).

-- ---------------------------------------------------------------------
-- 9. INSTALADORES — lista real de instaladores externos (reemplaza el
--    campo libre que tenía "Instalador externo" en proyectos). Mismo
--    patrón que items_catalogo: activo=false archiva, nunca se borra.
--    proyectos.instalador sigue siendo texto, ahora elegido desde esta
--    lista en vez de escrito a mano (sin FK a propósito: no hace falta
--    integridad referencial dura para un campo puramente informativo).
-- ---------------------------------------------------------------------
create table if not exists public.instaladores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists instaladores_nombre_unico on public.instaladores (lower(nombre));

-- Semilla: equipo de instaladores entregado por el cliente. No pisa
-- ediciones ya hechas por Jefatura si vuelves a correr este archivo.
insert into public.instaladores (nombre) values
  ('Carlos Alcántara'), ('Gustavo Montanares'), ('Luis Felipe Ureña'), ('Pedro Romero'),
  ('Felipe Villca'), ('Jorge Romero'), ('Miljan Atencio')
on conflict (lower(nombre)) do nothing;

alter table public.instaladores enable row level security;
drop policy if exists "instaladores: lectura autenticados" on public.instaladores;
create policy "instaladores: lectura autenticados"
  on public.instaladores for select to authenticated using (true);
drop policy if exists "instaladores: jefatura inserta" on public.instaladores;
create policy "instaladores: jefatura inserta"
  on public.instaladores for insert to authenticated
  with check (public.mi_rol() = 'jefatura');
drop policy if exists "instaladores: jefatura edita" on public.instaladores;
create policy "instaladores: jefatura edita"
  on public.instaladores for update to authenticated
  using (public.mi_rol() = 'jefatura') with check (public.mi_rol() = 'jefatura');
-- Sin policy de delete: "quitar" un instalador es archivarlo (activo=false), igual que items_catalogo.

-- ---------------------------------------------------------------------
-- Fin. Revisa Database -> Advisors en el dashboard para confirmar que
-- todas las tablas quedaron con RLS activo.
-- ---------------------------------------------------------------------
