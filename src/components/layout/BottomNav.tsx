// 下部ナビ：入力 / 台帳 / 資料 / 物件。
// 「資料」はレントロール・収支・入金・概要書をまとめたグループ（中で切替）。
import { PlusCircle, BookOpen, BarChart3, Building } from 'lucide-react'
import { useAppStore, type ViewKey } from '../../state/useAppStore'

const REPORT_VIEWS: ViewKey[] = ['rentroll', 'summary', 'payments', 'prospectus']

export function BottomNav() {
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
        'flex flex-col items-center gap-0.5 py-2.5 text-xs ' +
        (active ? 'text-slate-900 font-medium' : 'text-slate-400')
      }
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  )

  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200">
      <div className="max-w-3xl mx-auto grid grid-cols-4">
        <Item active={activeView === 'entry'} label="入力" icon={PlusCircle} onClick={() => setActiveView('entry')} />
        <Item active={activeView === 'ledger'} label="台帳" icon={BookOpen} onClick={() => setActiveView('ledger')} />
        <Item
          active={inReports}
          label="資料"
          icon={BarChart3}
          onClick={() => !inReports && setActiveView('rentroll')}
        />
        <Item active={activeView === 'properties'} label="物件" icon={Building} onClick={() => setActiveView('properties')} />
      </div>
    </nav>
  )
}
