-- Migration 031: Upcoming Events feature
-- Spec: docs/superpowers/specs/2026-04-24-upcoming-events-design.md
--
-- Adds:
--   - events                  admin-managed event records
--   - event_registrations     per-user RSVPs (hybrid: internal + optional external URL click)
--   - event_dismissals        per-user "do not show again" markers for the login pop-up
--   - v_active_events_for_user view used by the login pop-up trigger
--
-- Audience model (v1): all authenticated users see every published event.
-- Pop-up frequency: once per user per event, unless events.force_on_every_login = true.

BEGIN;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                  text        NOT NULL,
  short_description      text        NOT NULL,
  long_description       text,
  event_type             text        NOT NULL CHECK (event_type IN
                           ('ai_session','summit','certification','workshop','webinar','other')),
  location_type          text        NOT NULL CHECK (location_type IN
                           ('online','in_person','hybrid')),
  venue                  text,
  start_datetime         timestamptz NOT NULL,
  end_datetime           timestamptz NOT NULL,
  registration_url       text,
  registration_deadline  timestamptz,
  cover_image_url        text,
  force_on_every_login   boolean     NOT NULL DEFAULT false,
  is_published           boolean     NOT NULL DEFAULT false,
  created_by             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_end_after_start CHECK (end_datetime > start_datetime),
  CONSTRAINT events_deadline_before_start CHECK
    (registration_deadline IS NULL OR registration_deadline <= start_datetime)
);

CREATE INDEX IF NOT EXISTS idx_events_active
  ON events (is_published, end_datetime);
CREATE INDEX IF NOT EXISTS idx_events_start
  ON events (start_datetime);

CREATE TABLE IF NOT EXISTS event_registrations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  registered_at          timestamptz NOT NULL DEFAULT now(),
  external_link_clicked  boolean     NOT NULL DEFAULT false,
  external_clicked_at    timestamptz,
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_registrations_event
  ON event_registrations (event_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_user
  ON event_registrations (user_id);

CREATE TABLE IF NOT EXISTS event_dismissals (
  event_id               uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id                uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dismissed_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION set_events_updated_at();

-- ---------------------------------------------------------------------------
-- View: v_active_events_for_user
--   Returns active published events for the current user, omitting events the
--   user has already dismissed or registered for — unless the event has
--   force_on_every_login = true, in which case it's always included.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_active_events_for_user AS
SELECT
  e.*,
  (reg.id IS NOT NULL) AS already_registered,
  reg.external_link_clicked,
  (dis.user_id IS NOT NULL) AS already_dismissed
FROM events e
LEFT JOIN event_registrations reg
  ON reg.event_id = e.id
 AND reg.user_id  = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
LEFT JOIN event_dismissals dis
  ON dis.event_id = e.id
 AND dis.user_id  = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
WHERE e.is_published = true
  AND e.end_datetime > now()
  AND (
    e.force_on_every_login = true
    OR (reg.id IS NULL AND dis.user_id IS NULL)
  );

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE events                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dismissals       ENABLE ROW LEVEL SECURITY;

-- events: authenticated users read published + active; admins read everything
DROP POLICY IF EXISTS "events_select_published"  ON events;
CREATE POLICY "events_select_published"
  ON events FOR SELECT
  TO authenticated
  USING (is_published = true AND end_datetime > now());

DROP POLICY IF EXISTS "events_select_admin"      ON events;
CREATE POLICY "events_select_admin"
  ON events FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin');

-- events: admin-only writes
DROP POLICY IF EXISTS "events_insert_admin"      ON events;
CREATE POLICY "events_insert_admin"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "events_update_admin"      ON events;
CREATE POLICY "events_update_admin"
  ON events FOR UPDATE
  TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "events_delete_admin"      ON events;
CREATE POLICY "events_delete_admin"
  ON events FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');

-- event_registrations: users manage their own rows; admins read all
DROP POLICY IF EXISTS "evreg_select_own"         ON event_registrations;
CREATE POLICY "evreg_select_own"
  ON event_registrations FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS "evreg_insert_own"         ON event_registrations;
CREATE POLICY "evreg_insert_own"
  ON event_registrations FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "evreg_update_own"         ON event_registrations;
CREATE POLICY "evreg_update_own"
  ON event_registrations FOR UPDATE
  TO authenticated
  USING      (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1))
  WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1));

DROP POLICY IF EXISTS "evreg_delete_admin"       ON event_registrations;
CREATE POLICY "evreg_delete_admin"
  ON event_registrations FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin');

-- event_dismissals: users manage their own rows only
DROP POLICY IF EXISTS "evdis_select_own"         ON event_dismissals;
CREATE POLICY "evdis_select_own"
  ON event_dismissals FOR SELECT
  TO authenticated
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1));

DROP POLICY IF EXISTS "evdis_insert_own"         ON event_dismissals;
CREATE POLICY "evdis_insert_own"
  ON event_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1));

DROP POLICY IF EXISTS "evdis_delete_own"         ON event_dismissals;
CREATE POLICY "evdis_delete_own"
  ON event_dismissals FOR DELETE
  TO authenticated
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1));

-- Grant view access
GRANT SELECT ON v_active_events_for_user TO authenticated;

COMMIT;
