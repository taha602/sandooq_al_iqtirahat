-- صندوق الاقتراحات: مخطط قاعدة البيانات
-- نفّذ هذا الملف في Supabase SQL Editor بعد إنشاء مشروعك.
-- لا تضع service_role key في ملفات الموقع.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'reviewer' check (role in ('admin','manager','reviewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  tracking_token_hash text not null,
  type text not null check (type in ('suggestion','complaint','problem','initiative')),
  category text not null,
  title text not null check (char_length(title) between 3 and 100),
  content text not null check (char_length(content) between 10 and 4000),
  is_anonymous boolean not null default true,
  student_name text,
  class_name text,
  status text not null default 'new' check (status in ('new','reviewing','assigned','in_progress','resolved','closed')),
  public_update text,
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_anonymous and student_name is null) or (not is_anonymous and student_name is not null))
);

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  message text not null check (char_length(message) between 2 and 2000),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  note text not null check (char_length(note) between 2 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  submission_id uuid references public.submissions(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists submissions_created_at_idx on public.submissions(created_at desc);
create index if not exists submissions_status_idx on public.submissions(status);
create index if not exists submissions_assigned_to_idx on public.submissions(assigned_to);
create index if not exists responses_submission_idx on public.responses(submission_id, created_at);

-- دوال تحقق من دور المستخدم. SECURITY DEFINER لتفادي سياسات RLS الدائرية.
create or replace function public.current_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active=true $$;

create or replace function public.is_admin_or_manager()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_role() in ('admin','manager'),false) $$;

create or replace function public.can_access_submission(target_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select coalesce(
    public.current_role() in ('admin','manager')
    or exists(select 1 from public.submissions s where s.id=target_id and s.assigned_to=auth.uid()),
    false
  )
$$;

-- إنشاء رسالة عامة دون كشف أي بيانات إدارية. الرمز السري لا يُخزن كنص صريح.
create or replace function public.submit_suggestion(
  p_type text, p_category text, p_title text, p_content text,
  p_class_name text default null, p_is_anonymous boolean default true,
  p_student_name text default null
)
returns table(reference_number text, tracking_token text)
language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_ref text;
  v_token text;
  v_id uuid;
begin
  if p_type not in ('suggestion','complaint','problem','initiative') then raise exception 'Invalid type'; end if;
  if p_category is null or char_length(p_category)>80 then raise exception 'Invalid category'; end if;
  if p_title is null or char_length(trim(p_title)) not between 3 and 100 then raise exception 'Invalid title'; end if;
  if p_content is null or char_length(trim(p_content)) not between 10 and 4000 then raise exception 'Invalid content'; end if;
  if p_is_anonymous is false and (p_student_name is null or char_length(trim(p_student_name))<2 or char_length(p_student_name)>100) then raise exception 'Name required'; end if;
  if p_is_anonymous is true then p_student_name := null; end if;
  v_ref := 'SG-' || to_char(now() at time zone 'utc','YYYY') || '-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
  v_token := upper(encode(gen_random_bytes(8),'hex'));
  insert into public.submissions(reference_number,tracking_token_hash,type,category,title,content,is_anonymous,student_name,class_name)
  values(v_ref,encode(digest(v_token,'sha256'),'hex'),p_type,trim(p_category),trim(p_title),trim(p_content),p_is_anonymous,nullif(trim(p_student_name),''),nullif(trim(p_class_name),'')) returning id into v_id;
  return query select v_ref,v_token;
end $$;

-- متابعة عامة: لا تعيد الاسم أو الصف أو الملاحظات الداخلية أو هوية المسؤول.
create or replace function public.track_suggestion(p_reference_number text,p_tracking_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_row public.submissions%rowtype; v_replies jsonb;
begin
  select * into v_row from public.submissions
  where reference_number=trim(p_reference_number)
    and tracking_token_hash=encode(digest(upper(trim(p_tracking_token)),'sha256'),'hex');
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('message',message,'created_at',created_at) order by created_at),'[]'::jsonb)
  into v_replies from public.responses where submission_id=v_row.id and is_public=true;
  return jsonb_build_object('title',v_row.title,'status',v_row.status,'public_update',v_row.public_update,'public_replies',v_replies);
end $$;

-- سجل تلقائي لتغييرات الحالة والإحالة والإفادة العامة.
create or replace function public.log_submission_update()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if old.status is distinct from new.status or old.assigned_to is distinct from new.assigned_to or old.public_update is distinct from new.public_update then
    insert into public.activity_logs(submission_id,actor_id,action,details)
    values(new.id,auth.uid(),'submission_updated',jsonb_build_object(
      'old_status',old.status,'new_status',new.status,
      'old_assigned_to',old.assigned_to,'new_assigned_to',new.assigned_to
    ));
  end if;
  return new;
end $$;
drop trigger if exists submissions_audit_update on public.submissions;
create trigger submissions_audit_update after update on public.submissions
for each row execute function public.log_submission_update();

-- تفعيل RLS على كل الجداول.
alter table public.profiles enable row level security;
alter table public.submissions enable row level security;
alter table public.responses enable row level security;
alter table public.internal_notes enable row level security;
alter table public.activity_logs enable row level security;

-- السياسات: الحسابات لا تنشأ من واجهة عامة. أنشئها من Supabase Auth ثم أضف profile.
drop policy if exists "profiles read own or managers" on public.profiles;
create policy "profiles read own or managers" on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin_or_manager());
drop policy if exists "profiles manager update" on public.profiles;
create policy "profiles manager update" on public.profiles for update to authenticated
using (public.current_role()='admin') with check (public.current_role()='admin');

drop policy if exists "staff read assigned or all" on public.submissions;
create policy "staff read assigned or all" on public.submissions for select to authenticated
using (public.is_admin_or_manager() or assigned_to=auth.uid());
drop policy if exists "staff update assigned or all" on public.submissions;
create policy "staff update assigned or all" on public.submissions for update to authenticated
using (public.is_admin_or_manager() or assigned_to=auth.uid())
with check (public.is_admin_or_manager() or assigned_to=auth.uid());

drop policy if exists "staff read responses" on public.responses;
create policy "staff read responses" on public.responses for select to authenticated
using (public.can_access_submission(submission_id));
drop policy if exists "staff add responses" on public.responses;
create policy "staff add responses" on public.responses for insert to authenticated
with check (author_id=auth.uid() and public.can_access_submission(submission_id));
drop policy if exists "staff read notes" on public.internal_notes;
create policy "staff read notes" on public.internal_notes for select to authenticated
using (public.can_access_submission(submission_id));
drop policy if exists "staff add notes" on public.internal_notes;
create policy "staff add notes" on public.internal_notes for insert to authenticated
with check (author_id=auth.uid() and public.can_access_submission(submission_id));
drop policy if exists "managers read logs" on public.activity_logs;
create policy "managers read logs" on public.activity_logs for select to authenticated
using (public.is_admin_or_manager());

-- لا تمنح anon وصولاً مباشراً إلى الجداول. يسمح فقط باستدعاء دالتي الإرسال والمتابعة.
revoke all on public.profiles,public.submissions,public.responses,public.internal_notes,public.activity_logs from anon,authenticated;
grant select on public.profiles to authenticated;
grant select,update on public.submissions to authenticated;
grant select,insert on public.responses to authenticated;
grant select,insert on public.internal_notes to authenticated;
grant select on public.activity_logs to authenticated;
revoke all on function public.submit_suggestion(text,text,text,text,text,boolean,text) from public;
revoke all on function public.track_suggestion(text,text) from public;
revoke all on function public.current_role() from public,anon;
revoke all on function public.is_admin_or_manager() from public,anon;
revoke all on function public.can_access_submission(uuid) from public,anon;
revoke all on function public.log_submission_update() from public,anon,authenticated;
grant execute on function public.submit_suggestion(text,text,text,text,text,boolean,text) to anon,authenticated;
grant execute on function public.track_suggestion(text,text) to anon,authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin_or_manager() to authenticated;
grant execute on function public.can_access_submission(uuid) to authenticated;

-- أنشئ المستخدمين من Authentication > Users ثم أضف بياناتهم هنا.
-- لا تضع كلمات مرور في هذا الملف.
-- مثال:
-- insert into public.profiles(id,display_name,role)
-- values ('AUTH-USER-UUID','مدير النظام','admin');
