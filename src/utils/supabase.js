import { createClient } from '@supabase/supabase-js';

// Config resolution — fail loud in production, warn loudly in dev.
//
// These used to fall back to the hardcoded live project silently, so a fork, a
// misconfigured CI job, or a deploy with missing env vars would read and WRITE
// the production database while appearing healthy. The anon key is public by
// design and RLS is the real boundary, but pointing the wrong DEPLOY at real
// user data is not something to discover later — so a production build now
// refuses to start without explicit config.
//
// Dev keeps the fallback (the repo has never shipped a .env and every local
// workflow depends on it) but says so on every boot.
const DEV_FALLBACK_URL = "https://tczqtwxrnptgajxwynmg.supabase.co";
// Publishable key (`sb_publishable_*`), not a legacy anon JWT. Publishable keys
// are public by design — this exact value ships inside the browser bundle on
// every deploy, and RLS remains the real security boundary — so committing it
// is safe in a way a service/secret key never would be.
//
// This replaced a legacy anon JWT on 2026-08-17. Legacy JWT keys cannot be
// rotated any more, only migrated away from and then deactivated; a deactivated
// key sitting here would break every local dev boot that has no .env, which per
// the note above is the normal case for this repo.
const DEV_FALLBACK_ANON_KEY = "sb_publishable_PnBNQnLU0MkqVbjGz--q8Q_WoURGrmf";

const PLACEHOLDERS = new Set(["https://your-project.supabase.co", "your-anon-key"]);

function resolve(name, value, fallback) {
  const missing = !value || PLACEHOLDERS.has(value);
  if (!missing) return value;
  if (import.meta.env.PROD) {
    throw new Error(
      `[config] ${name} is missing or still set to the .env.example placeholder. ` +
      `Production builds must supply Supabase config explicitly — refusing to ` +
      `fall back to the shared project.`
    );
  }
  console.warn(
    `[config] ${name} not set — falling back to the shared dev Supabase project. ` +
    `This writes to REAL data. Copy .env.example to .env to point somewhere else.`
  );
  return fallback;
}

const sb = createClient(
  resolve("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL, DEV_FALLBACK_URL),
  resolve("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY, DEV_FALLBACK_ANON_KEY),
  { auth: { experimental: { passkey: true } } }
);

export { sb };
