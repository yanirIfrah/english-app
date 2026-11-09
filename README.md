# לומדים אנגלית – Learn English

Web edition (Vercel + Supabase).

- `public/` – the app (static, built by `build.py` from the shared source)
- `api/` – Vercel serverless functions: `config`, `admin` (user management, uses the service key), `claude` (optional AI features)
- `supabase/schema.sql` – database schema, row-level security and admin functions

## Vercel environment variables
| Name | Where from |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Supabase → API Keys (anon / publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys (secret / service_role) – server only |
| `ANTHROPIC_API_KEY` | optional – enables plan generation, scanning and auto-translation |

The first account that registers becomes ADMIN.
