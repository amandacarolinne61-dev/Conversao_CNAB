import { createClient } from '@supabase/supabase-js'

// Cliente do NAVEGADOR - usa a chave anon (pública), nunca a service role.
// Só serve pra assinar mudanças via Supabase Realtime (ex: dashboard). Toda
// escrita/leitura de dado sensível continua passando pelas rotas /api, que
// usam lib/supabaseClient.js (service role, servidor).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabaseBrowser =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
    : null
