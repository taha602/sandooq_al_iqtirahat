-- تثبيت وحذف الشكاوى + إلغاء الرمز السري (رقم متابعة واحد)
alter table public.sg_submissions add column if not exists pinned boolean not null default false;
alter table public.sg_submissions add column if not exists pinned_at timestamptz;
grant delete on public.sg_submissions to authenticated;
create policy "sg staff delete submissions" on public.sg_submissions for delete to authenticated using (public.sg_is_admin_or_manager());
alter table public.sg_submissions drop column if exists tracking_token_hash;
-- ثم أعد إنشاء الدالتين submit_suggestion(…) تُرجع reference_number فقط، و track_suggestion(p_reference_number) (طُبّق في المشروع مباشرة).
