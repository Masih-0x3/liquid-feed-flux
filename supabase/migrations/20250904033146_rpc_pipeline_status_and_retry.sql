-- RPC: get_post_pipeline_status
create or replace function public.get_post_pipeline_status(tweet_ids text[])
returns table (
  tweet_id text,
  ingest_at timestamptz,
  media_total int,
  media_downloaded int,
  lang_original text,
  translated_at timestamptz,
  translate_status text,
  translate_error text,
  delivery_status text,
  posted_at timestamptz,
  delivery_error text,
  attempts int
) language sql stable as $$
  select
    p.tweet_id,
    p.created_at as ingest_at,
    coalesce((select count(*) from public.media m where m.tweet_id = p.tweet_id), 0) as media_total,
    coalesce((select count(*) from public.media m where m.tweet_id = p.tweet_id and m.downloaded_at is not null), 0) as media_downloaded,
    p.lang_original,
    p.translated_at,
    (select j.status from public.jobs j where j.type = 'translate' and (j.payload->>'tweet_id') = p.tweet_id order by j.created_at desc limit 1) as translate_status,
    (select j.last_error from public.jobs j where j.type = 'translate' and (j.payload->>'tweet_id') = p.tweet_id order by j.created_at desc limit 1) as translate_error,
    (select d.status from public.deliveries d where d.subject_type = 'post' and d.subject_id = p.tweet_id order by d.created_at desc limit 1) as delivery_status,
    (select d.posted_at from public.deliveries d where d.subject_type = 'post' and d.subject_id = p.tweet_id and d.status = 'posted' order by d.created_at desc limit 1) as posted_at,
    coalesce(
      (select d.last_error from public.deliveries d where d.subject_type = 'post' and d.subject_id = p.tweet_id order by d.created_at desc limit 1),
      (select j.last_error from public.jobs j where j.type = 'deliver' and (j.payload->>'tweet_id') = p.tweet_id order by j.created_at desc limit 1)
    ) as delivery_error,
    coalesce((select max(d.attempts) from public.deliveries d where d.subject_type = 'post' and d.subject_id = p.tweet_id), 0) as attempts
  from public.posts p
  where p.tweet_id = any (tweet_ids)
  order by p.created_at desc
$$;

-- RPC: retry_step
create or replace function public.retry_step(tweet_id text, step text)
returns boolean
language plpgsql
security definer
as $$
declare
  job_type text;
begin
  if step = 'translate' then job_type := 'translate';
  elsif step = 'deliver' then job_type := 'deliver';
  elsif step = 'media' then job_type := 'download_media';
  elsif step = 'moderate' then job_type := 'moderate';
  else
    raise exception 'Unknown step %', step;
  end if;

  insert into public.jobs(type, payload, status, next_run_at)
  values(job_type, jsonb_build_object('tweet_id', tweet_id, 'subject_type', 'post', 'subject_id', tweet_id), 'pending', now());

  insert into public.pipeline_events(subject_type, subject_id, step, status, started_at, meta)
  values('post', tweet_id, step, 'queued', now(), jsonb_build_object('source','rpc.retry_step'));

  return true;
end;
$$;
