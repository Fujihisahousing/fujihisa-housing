// ヘッダー（アプリ名・権限バッジ・ログアウト）
import { Building2, LogOut, ShieldCheck, User as UserIcon } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'

export function Header() {
  const { user, role, isAdmin, signOut } = useAuth()

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center w-8 h-8 rounded-lg bg-slate-900 text-white">
            <Building2 className="w-5 h-5" />
          </div>
          <span className="font-bold text-slate-800">RentBook</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ' +
              (isAdmin ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')
            }
            title={user?.email ?? ''}
          >
            {isAdmin ? <ShieldCheck className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
            {role === 'admin' ? '管理者' : role === 'staff' ? 'スタッフ' : '権限未設定'}
          </span>
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">ログアウト</span>
          </button>
        </div>
      </div>
    </header>
  )
}
