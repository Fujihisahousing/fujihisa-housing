// 会計風入力UI：収入/支出カテゴリのタイル表示。タップでカテゴリを選んで入力シートへ。
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, type TxType } from '../../types'

export function EntryGrid({ onPick }: { onPick: (type: TxType, category: string) => void }) {
  return (
    <div className="space-y-6">
      <Section
        title="収入"
        accent="text-emerald-700"
        ring="hover:border-emerald-300 hover:bg-emerald-50"
        items={INCOME_CATEGORIES}
        onPick={(c) => onPick('income', c)}
      />
      <Section
        title="支出"
        accent="text-rose-700"
        ring="hover:border-rose-300 hover:bg-rose-50"
        items={EXPENSE_CATEGORIES}
        onPick={(c) => onPick('expense', c)}
      />
    </div>
  )
}

function Section({
  title,
  accent,
  ring,
  items,
  onPick,
}: {
  title: string
  accent: string
  ring: string
  items: readonly string[]
  onPick: (category: string) => void
}) {
  return (
    <div>
      <h3 className={'text-sm font-semibold mb-2 ' + accent}>{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {items.map((c) => (
          <button
            key={c}
            onClick={() => onPick(c)}
            className={
              'rounded-xl border border-slate-200 bg-white py-4 px-3 text-sm font-medium text-slate-700 transition-colors ' +
              ring
            }
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
