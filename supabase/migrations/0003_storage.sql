-- Private bucket for generated resume PDFs. Path convention: {profile_id}/v{version}.pdf
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update set public = false;

drop policy if exists "resumes_owner_read" on storage.objects;
create policy "resumes_owner_read" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
-- Uploads happen server-side with the service role (no insert policy for clients).
