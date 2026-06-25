// ログイン画面（メール＋パスワード）。アカウント発行は管理者が Supabase 側で行う（SOW 6.0）。
import { useState, type FormEvent } from 'react'
import { Building2, Loader2, LogIn } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { isSupabaseConfigured } from '../lib/supabase'

export function LoginView() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isSupabaseConfigured) {
      setError('.env.local の Supabase 接続情報（URL / anon key）が未設定です。')
      return
    }
    setSubmitting(true)
    const { error } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (error) setError(translateError(error))
  }

  return (
    <div className="min-h-full bg-slate-50 flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-white shadow-sm border border-slate-200 p-8"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="grid place-items-center w-11 h-11 rounded-xl bg-slate-900 text-white">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-slate-800">フジヒサハウジング管理台帳</h1>
            <p className="text-xs text-slate-500">収益物件管理システム</p>
          </div>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-1">メールアドレス</label>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />

        <label className="block text-sm font-medium text-slate-700 mb-1">パスワード</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />

        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3 mb-4">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60 transition-colors"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          ログイン
        </button>

        <p className="mt-4 text-xs text-slate-400 leading-relaxed">
          アカウントは管理者が発行します。ログインできない場合は管理者にご連絡ください。
        </p>
      </form>
    </div>
  )
}

function translateError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'メールアドレスまたはパスワードが違います。'
  if (/email not confirmed/i.test(message)) return 'メールアドレスが未確認です。管理者にご確認ください。'
  return message
}
