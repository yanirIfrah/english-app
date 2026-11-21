# לירד שעון נוכחות

אפליקציית ניהול שעות עבודה לעובדים (Vercel + Supabase).

- `public/` – האפליקציה (קובץ אחד, עברית, מותאם לנייד)
- `api/` – פונקציות שרת: `config`, `admin` (ניהול משתמשים עם מפתח השרת)
- `supabase/schema.sql` – מסד הנתונים, הרשאות (RLS) ופונקציות ניהול

## משתני סביבה ב-Vercel
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` – סודי, צד שרת בלבד

המשתמש הראשון שנרשם הופך ל-ADMIN.
