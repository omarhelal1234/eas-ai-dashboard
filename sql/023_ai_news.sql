-- 023: AI News feed table, indexes, RLS, and pg_cron cleanup job
-- Spec: docs/superpowers/specs/2026-04-17-ai-news-feed-design.md

-- Table
CREATE TABLE IF NOT EXISTS ai_news (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  summary       text,
  url           text        NOT NULL UNIQUE,
  source        text        NOT NULL,
  topic         text        NOT NULL,
  image_url     text,
  published_at  timestamptz NOT NULL,
  fetched_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_news_published ON ai_news (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_news_source    ON ai_news (source);

-- RLS
ALTER TABLE ai_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_news_select_authenticated"
  ON ai_news FOR SELECT
  TO authenticated
  USING (true);

-- pg_cron: nightly cleanup of items older than 30 days (03:00 UTC)
SELECT cron.schedule(
  'ai-news-cleanup',
  '0 3 * * *',
  $$DELETE FROM ai_news WHERE published_at < now() - interval '30 days'$$
);
