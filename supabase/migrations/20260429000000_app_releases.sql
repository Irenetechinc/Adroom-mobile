-- App releases registry — powers two app behaviors:
--   1. "What's New" changelog modal that pops up on first launch of a new version
--   2. Force-update gate that blocks the app when the user is on an unsupported build
--
-- Each row represents one shipped release (Android, iOS, or both via 'all').
-- The mobile app calls GET /api/app/version on launch with its current version
-- and the backend computes:
--   * latestVersion  — highest published version for this platform
--   * minSupportedVersion — highest version flagged is_min_supported = TRUE
--   * forceUpdate    — TRUE if currentVersion < minSupportedVersion
--   * updateAvailable — TRUE if currentVersion < latestVersion
--   * changelog      — every published release the client can render
--
-- Releases are inserted by the team when shipping a new build (manual SQL or
-- via the admin panel). No demo data — only the real shipped version is seeded.

CREATE TABLE IF NOT EXISTS public.app_releases (
  id              BIGSERIAL PRIMARY KEY,
  platform        TEXT NOT NULL CHECK (platform IN ('all','android','ios')),
  version         TEXT NOT NULL,
  -- When TRUE, every client below this version is force-updated. Multiple rows
  -- can be flagged TRUE over time; the highest such version wins.
  is_min_supported BOOLEAN NOT NULL DEFAULT FALSE,
  -- When FALSE the row is hidden from the version endpoint (drafts / rollbacks).
  is_published    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Per-row override that forces an update for THIS specific version even if
  -- it isn't above the global min_supported. Use sparingly.
  force_update    BOOLEAN NOT NULL DEFAULT FALSE,
  store_url       TEXT,
  -- Markdown bullets shown in the What's New modal.
  changelog_md    TEXT NOT NULL DEFAULT '',
  released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, version)
);

CREATE INDEX IF NOT EXISTS app_releases_platform_published_idx
  ON public.app_releases (platform, is_published, released_at DESC);

CREATE INDEX IF NOT EXISTS app_releases_min_supported_idx
  ON public.app_releases (platform)
  WHERE is_min_supported = TRUE;

-- Public read access. The endpoint is unauthenticated because it must work
-- before the user signs in (and on the very first launch of a new build).
ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_releases_public_read" ON public.app_releases;
CREATE POLICY "app_releases_public_read"
  ON public.app_releases
  FOR SELECT
  USING (is_published = TRUE);

-- Service-role bypasses RLS automatically for inserts/updates from the backend.

-- Seed the currently shipped release. Notes describe what is actually in the
-- 2.2.10 build — no fictional features.
INSERT INTO public.app_releases
  (platform, version, is_min_supported, is_published, force_update, store_url, changelog_md, released_at)
VALUES
  (
    'android',
    '2.2.10',
    FALSE,
    TRUE,
    FALSE,
    'https://play.google.com/store/apps/details?id=com.adroom.mobile',
    E'• Push notifications now arrive reliably when the app is closed (FCM v1 wired end-to-end).\n• New diagnostic in Notifications — tap the paper-airplane icon to see in plain English why a push isn''t reaching this device.\n• Bug reports and feature requests on the website now go straight to the AdRoom team and the database, with email confirmation.\n• Help, bug-report and feature-request pages were rebuilt to look great on phones and tablets.\n• New "What''s New" screen so you can see exactly what changed every time you update.\n• Built-in update check on launch — you''ll be prompted (or required) to upgrade when a new build ships.',
    NOW()
  )
ON CONFLICT (platform, version) DO NOTHING;
