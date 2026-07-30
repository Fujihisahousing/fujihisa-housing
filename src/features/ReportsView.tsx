// 資料グループの切替コンテナ。タブは2段構成：
//   1段目＝日常見る資料（レントロール・収支表・入金状況・物件概要書）
//   2段目＝全物件まとめの提出用資料（収支管理表・現況報告書）。色を変えて区別する。
import { RentRoll } from './rentroll/RentRoll'
import { IncomeStatement } from './summary/IncomeStatement'
import { ManagementTable } from './summary/ManagementTable'
import { PaymentStatus } from './payments/PaymentStatus'
import { Prospectus } from './prospectus/Prospectus'
import { PrintCurrentStatus } from './reports/PrintCurrentStatus'
import { useAppStore, type ViewKey } from '../state/useAppStore'
import type { Property } from '../types'

const TABS_ROW1: { key: ViewKey; label: string }[] = [
  { key: 'rentroll', label: 'レントロール' },
  { key: 'summary', label: '収支表' },
  { key: 'payments', label: '入金状況' },
  { key: 'prospectus', label: '物件概要書' },
]
// 2段目は全物件まとめの提出用資料。1段目と見分けが付くよう藍色にする。
const TABS_ROW2: { key: ViewKey; label: string }[] = [
  { key: 'mgmt', label: '収支管理表' },
  { key: 'statusreport', label: '現況報告書' },
]

const TAB_BASE = 'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors '
const TONE = {
  row1: {
    on: 'bg-slate-900 text-white',
    off: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50',
  },
  row2: {
    on: 'bg-indigo-600 text-white',
    off: 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100',
  },
} as const

export function ReportsView({ properties }: { properties: Property[] }) {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const activeProperty = useAppStore((s) => s.activeProperty)
  const propertyName = activeProperty
    ? (properties.find((p) => p.id === activeProperty)?.name ?? '物件')
    : '全体'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto">
          {TABS_ROW1.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveView(t.key)}
              className={TAB_BASE + (activeView === t.key ? TONE.row1.on : TONE.row1.off)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {TABS_ROW2.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveView(t.key)}
              className={TAB_BASE + (activeView === t.key ? TONE.row2.on : TONE.row2.off)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeView === 'rentroll' && <RentRoll properties={properties} />}
      {activeView === 'summary' && <IncomeStatement propertyName={propertyName} />}
      {activeView === 'mgmt' && <ManagementTable properties={properties} />}
      {activeView === 'payments' && <PaymentStatus properties={properties} propertyName={propertyName} />}
      {activeView === 'prospectus' && <Prospectus properties={properties} />}
      {activeView === 'statusreport' && <PrintCurrentStatus properties={properties} />}
    </div>
  )
}
