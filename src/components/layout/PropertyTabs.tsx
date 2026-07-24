// 最上段の物件タブ（「全体」＋物件別の切替）。activeProperty を切り替える。
import { useEffect, useMemo, useRef } from 'react'
import type { Property } from '../../types'
import { useAppStore } from '../../state/useAppStore'
import { isDisposedForStatusReport, isDisposedForRentRoll } from '../../lib/calc'

// Tab はモジュール直下で定義すること。PropertyTabs の中で定義すると
// 再レンダリングのたびに別のコンポーネント型になり、ボタンが毎回
// アンマウント→再マウントされる（無駄なDOM再生成）。
function Tab({
  id,
  label,
  active,
  onSelect,
}: {
  id: string | null
  label: string
  active: boolean
  onSelect: (id: string | null) => void
}) {
  return (
    <button
      data-active={active || undefined}
      onClick={() => onSelect(id)}
      className={
        'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ' +
        (active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')
      }
    >
      {label}
    </button>
  )
}

export function PropertyTabs({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const setActiveProperty = useAppStore((s) => s.setActiveProperty)
  const activeView = useAppStore((s) => s.activeView)
  const stripRef = useRef<HTMLDivElement>(null)

  // 決済後の物件は、過去参照が不要なビューのタブから外す。
  //  現況報告書 → 決済月の翌月から / レントロール → 来期から。
  //  収支表・入金状況は過去を年度/年月で参照するのでタブは残す。
  const visibleProperties = useMemo(() => {
    const today = new Date()
    return properties.filter((p) => {
      if (activeView === 'statusreport') return !isDisposedForStatusReport(p.disposed_date, today)
      if (activeView === 'rentroll') return !isDisposedForRentRoll(p.disposed_date, today)
      return true
    })
  }, [properties, activeView])

  // 物件を選ぶと（画面の切り替わりに伴うレイアウト変化で）タブの横スクロールが
  // 先頭に戻ってしまい、右側の物件を選んだときに選択中のタブが画面外へ消える。
  // 選択が変わったら選択中のタブを必ず表示範囲内に入れ直す。
  // inline:'nearest' なので既に見えている場合は動かない（＝位置はそのまま保たれる）。
  //
  // リセットが起きるタイミングが下の画面の再描画に依存していて特定できないため、
  // 直後・次のタスク・少し後 の3回チェックする。既に見えていれば何も起きないので
  // 余分に呼んでも副作用は無い。requestAnimationFrame は背面タブで止まるため使わない。
  useEffect(() => {
    const ensureVisible = () => {
      stripRef.current
        ?.querySelector<HTMLElement>('[data-active]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    ensureVisible()
    const timers = [window.setTimeout(ensureVisible, 0), window.setTimeout(ensureVisible, 200)]
    return () => timers.forEach(clearTimeout)
  }, [activeProperty, properties])

  return (
    <div className="bg-slate-50 border-b border-slate-200">
      <div ref={stripRef} className="max-w-3xl mx-auto px-5 py-2.5 flex gap-2 overflow-x-auto">
        <Tab id={null} label="全体" active={activeProperty === null} onSelect={setActiveProperty} />
        {visibleProperties.map((p) => (
          <Tab
            key={p.id}
            id={p.id}
            label={p.name}
            active={activeProperty === p.id}
            onSelect={setActiveProperty}
          />
        ))}
      </div>
    </div>
  )
}
