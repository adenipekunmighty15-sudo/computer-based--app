-- Atomic AI generation queue for concurrent workers.
DO $$
BEGIN
  CREATE TYPE public.job_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 10 CHECK (count > 0 AND count <= 100),
  class_level TEXT NOT NULL DEFAULT 'General',
  difficulty TEXT NOT NULL DEFAULT 'mixed',
  job_type TEXT NOT NULL DEFAULT 'objective',
  status public.job_status NOT NULL DEFAULT 'pending',
  worker_id TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON public.job_queue(status, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id TEXT)
RETURNS TABLE (
  job_id UUID,
  job_subject TEXT,
  job_topic TEXT,
  job_count INTEGER,
  job_class_level TEXT,
  job_difficulty TEXT,
  job_type TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_job public.job_queue%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.job_queue
  WHERE status = 'pending'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.job_queue
  SET status = 'processing', worker_id = p_worker_id, started_at = NOW(), error_message = NULL
  WHERE id = v_job.id;

  RETURN QUERY SELECT v_job.id, v_job.subject, v_job.topic, v_job.count,
    v_job.class_level, v_job.difficulty, v_job.job_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id UUID, p_worker_id TEXT, p_result JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.job_queue
  SET status = 'completed', result = p_result, completed_at = NOW()
  WHERE id = p_job_id AND status = 'processing' AND worker_id = p_worker_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_job(p_job_id UUID, p_worker_id TEXT, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.job_queue
  SET status = CASE WHEN retry_count + 1 >= 3 THEN 'failed' ELSE 'pending' END,
      retry_count = retry_count + 1,
      error_message = LEFT(p_error, 2000),
      worker_id = CASE WHEN retry_count + 1 >= 3 THEN worker_id ELSE NULL END,
      started_at = CASE WHEN retry_count + 1 >= 3 THEN started_at ELSE NULL END
  WHERE id = p_job_id AND status = 'processing' AND worker_id = p_worker_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_stale_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE v_reset_count INTEGER;
BEGIN
  UPDATE public.job_queue
  SET status = 'pending', worker_id = NULL, started_at = NULL,
      retry_count = retry_count + 1,
      error_message = 'Recovered after worker timeout'
  WHERE status = 'processing'
    AND started_at < NOW() - INTERVAL '10 minutes'
    AND retry_count < 3;
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RETURN v_reset_count;
END;
$$;
