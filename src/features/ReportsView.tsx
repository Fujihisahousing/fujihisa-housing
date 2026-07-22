// 資料グループ：レントロール／収支表／入金状況／物件概要書 の切替コンテナ。
import { RentRoll } from './rentroll/RentRoll'
import { IncomeStatement } from './summary/IncomeStatement'
import { PaymentStatus } from './payments/PaymentStatus'
import { Prospectus } from './prospectus/Prospectus'
import { ExportPatternBar } from './ExportPatternBar'
import { useAppStore, type ViewKey } from '../state/useAppStore'
import type { Property } from '../types'

const TABS: { key: ViewKey; label: string }[] = [
  { key: 'rentroll', label: 'レントロール' },
  { key: 'summary', label: '収支表' },
  { key: 'payments', label: '入金状況' },
  { key: 'prospectus', label: '物件概要書' },
]

export function ReportsView({ properties }: { properties: Property[] }) {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const activeProperty = useAppStore((s) => s.activeProperty)
  const propertyName = activeProperty
    ? (properties.find((p) => p.id === activeProperty)?.name ?? '物件')
    : '全体'

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveView(t.key)}
            className={
              'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ' +
              (activeView === t.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <ExportPatternBar properties={properties} />

      {activeView === 'rentroll' && <RentRoll properties={properties} propertyName={propertyName} />}
      {activeView === 'summary' && <IncomeStatement propertyName={propertyName} />}
      {activeView === 'payments' && <PaymentStatus properties={properties} propertyName={propertyName} />}
      {activeView === 'prospectus' && <Prospectus properties={properties} />}
    </div>
  )
}
