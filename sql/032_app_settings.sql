-- Migration 032: App Settings key-value store
-- Stores admin-configurable global settings (e.g., task hour caps).
-- RLS: everyone can read; only admins can write.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select_all"
  ON app_settings FOR SELECT
  USING (true);

CREATE POLICY "app_settings_write_admin"
  ON app_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Seed defaults (idempotent)
INSERT INTO app_settings (key, value) VALUES
  ('max_weekly_task_hours_before_ai', '60'),
  ('max_task_pct_after_ai',           '30')
ON CONFLICT (key) DO NOTHING;
