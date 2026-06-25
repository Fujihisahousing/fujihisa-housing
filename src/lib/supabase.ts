import { createClient } from '@supabase/supabase-js'

// 環境変数（.env.local）から接続情報を読む。
// VITE_ プレフィックスが付いた変数のみクライアントに露出する（Vite仕様）。
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** 接続情報が揃っているか（M0 の起動確認・UI 表示で使用） */
export const isSupabaseConfigured =
  Boolean(url) &&
  Boolean(anonKey) &&
  anonKey !== 'ここに anon public key を貼る'

if (!isSupabaseConfigured) {
  // 起動時に気づけるよう警告（アプリは落とさない）
  console.warn(
    '[RentBook] Supabase 接続情報が未設定です。.env.local に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください。',
  )
}

// anon key はクライアントに公開される前提のキー。守りは Supabase の RLS が担う。
// service_role（秘密の鍵）は絶対にここへ置かない。
export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export const supabaseUrl = url
