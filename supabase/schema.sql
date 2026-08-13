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

-- Un único titular por rol (alcance elegido: 1 Coordinador + 1 Jefatura).
-- Para habilitar varios coordinadores en el futuro, elimina este índice.
create unique index if not exists profiles_rol_unico on public.profiles(rol);

-- Crea el perfil automáticamente cuando alguien se registra (signUp)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'nombre', new.email),
          coalesce(new.raw_user_meta_data->>'rol', 'coordinador'));
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

-- RN-4/RN-12: el Coordinador no puede editar fechas, tipo ni reasignar el
-- proyecto (§2). Solo Jefatura puede. El checklist se recalcula server-side
-- si cambia el tipo (ver función siguiente); aquí solo se protege el campo.
create or replace function public.proyecto_restringir_edicion()
returns trigger language plpgsql as $$
begin
  if public.mi_rol() <> 'jefatura' then
    if new.fecha_inicio is distinct from old.fecha_inicio
       or new.fecha_termino is distinct from old.fecha_termino
       or new.tipo is distinct from old.tipo
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
-- Fin. Revisa Database -> Advisors en el dashboard para confirmar que
-- todas las tablas quedaron con RLS activo.
-- ---------------------------------------------------------------------
