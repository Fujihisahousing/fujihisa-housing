// 最上段の物件タブ（「全体」＋物件別の切替）。activeProperty を切り替える。
import type { Property } from '../../types'
import { useAppStore } from '../../state/useAppStore'

export function PropertyTabs({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const setActiveProperty = useAppStore((s) => s.setActiveProperty)

  const Tab = ({ id, label }: { id: string | null; label: string }) => {
    const active = activeProperty === id
    return (
      <button
        onClick={() => setActiveProperty(id)}
        className={
          'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ' +
          (active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')
        }
      >
        {label}
      </button>
    )
  }

  return (
    <div className="bg-slate-50 border-b border-slate-200">
      <div className="max-w-3xl mx-auto px-5 py-2.5 flex gap-2 overflow-x-auto">
        <Tab id={null} label="全体" />
        {properties.map((p) => (
          <Tab key={p.id} id={p.id} label={p.name} />
        ))}
      </div>
    </div>
  )
}
