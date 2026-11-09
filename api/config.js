// Public configuration for the browser (the anon key is meant to be public; RLS protects the data).
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    claude: !!process.env.ANTHROPIC_API_KEY
  });
}
