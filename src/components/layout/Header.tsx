// ヘッダー（アプリ名・ナビ・権限バッジ・ログアウト）
import { Building2, LogOut, ShieldCheck, User as UserIcon, PlusCircle, BarChart3, BookOpen, Building } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import { useAppStore, type ViewKey } from '../../state/useAppStore'

const REPORT_VIEWS: ViewKey[] = ['rentroll', 'summary', 'payments', 'prospectus']

export function Header() {
  const { user, role, isAdmin, signOut } = useAuth()
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const inReports = REPORT_VIEWS.includes(activeView)

  const Item = ({
    active,
    label,
    icon: Icon,
    onClick,
  }: {
    active: boolean
    label: string
    icon: typeof PlusCircle
    onClick: () => void
  }) => (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ' +
        (active ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-800')
      }
    >
      <Icon className="w-4 h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-5 h-14 flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <div className="grid place-items-center w-8 h-8 rounded-lg bg-slate-900 text-white">
            <Building2 className="w-5 h-5" />
          </div>
          <span className="hidden md:inline font-bold text-slate-800">フジヒサハウジング管理台帳</span>
        </div>

        {/* ナビ（タイトル横） */}
        <nav className="flex items-center gap-1">
          <Item active={activeView === 'entry'} label="入力" icon={PlusCircle} onClick={() => setActiveView('entry')} />
          <Item active={inReports} label="資料" icon={BarChart3} onClick={() => !inReports && setActiveView('rentroll')} />
          <Item active={activeView === 'ledger'} label="台帳" icon={BookOpen} onClick={() => setActiveView('ledger')} />
          <Item active={activeView === 'properties'} label="物件" icon={Building} onClick={() => setActiveView('properties')} />
        </nav>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span
            className={
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ' +
              (isAdmin ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')
            }
            title={user?.email ?? ''}
          >
            {isAdmin ? <ShieldCheck className="w-3.5 h-3.5" /> : <UserIcon className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{role === 'admin' ? '管理者' : role === 'staff' ? 'スタッフ' : '権限未設定'}</span>
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
