# Telegram Mini App deployment (Vercel + Supabase)

This variant uses Telegram as the identity provider, a Vercel Function as the trusted API,
and Supabase Postgres for synchronized workout data. The browser never receives a Supabase
secret. Every data request is authorized by validating Telegram's signed `initData` on the
server.

## 1. Create the Telegram bot

1. Open `@BotFather` in Telegram and run `/newbot`.
2. Save the bot token. It becomes the server-only `TELEGRAM_BOT_TOKEN` value in Vercel.
3. Do not put the token in a `VITE_` variable, source file, or Supabase table.

The Mini App URL is configured after the first Vercel deployment in step 4.

## 2. Create the Supabase database

1. Create a Supabase project.
2. Open **SQL Editor**, paste `supabase/migrations/001_telegram_profiles.sql`, and run it.
3. From **Project Settings → API**, copy:
   - Project URL → `SUPABASE_URL`
   - Secret key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`

Older Supabase projects may use the legacy `service_role` value as
`SUPABASE_SERVICE_ROLE_KEY`. Both are supported. Never expose either secret in frontend code.

The migration enables RLS and removes all direct access for `anon` and `authenticated`.
Only the server-side Vercel Function can access the table.

## 3. Deploy to Vercel

Import this repository into Vercel. Keep the repository root as the project root; `vercel.json`
already defines the build command, output directory, API rewrite, and function duration.

Add these environment variables to **Production**, **Preview**, and **Development** as needed:

```text
TELEGRAM_BOT_TOKEN=123456789:bot-token-from-BotFather
SUPABASE_URL=https://project-ref.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Deploy, then verify the public endpoint:

```text
https://your-project.vercel.app/api/health
```

It should return `{"ok":true,"storage":"supabase","auth":"telegram"}`. `/api/me` is
expected to return HTTP 401 in a normal browser because it only accepts signed Telegram data.

## 4. Connect the Mini App in BotFather

In `@BotFather`, open the bot's settings and configure its **Menu Button** or create a Mini App.
Use the production HTTPS URL from Vercel, for example:

```text
https://your-project.vercel.app
```

Open the bot, tap its menu button, and create a workout or weigh-in. Reload the Mini App and
confirm that the data is restored from Supabase.

## Local verification

The production authentication flow requires real Telegram `initData`; a regular local browser
can still use the device-only guest mode. Production requests older than 24 hours are rejected by
default. Override that limit only if necessary with `TELEGRAM_AUTH_MAX_AGE` (seconds).

Exercise images and animations are loaded from the pinned upstream dataset CDN during the Vercel
build, so the 140 MB media directory is not part of the deployment.
