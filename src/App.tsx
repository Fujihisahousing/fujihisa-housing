import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoginView } from './auth/LoginView'
import { Header } from './components/layout/Header'
import { PropertyTabs } from './components/layout/PropertyTabs'
import { RoomEntry } from './components/entry/RoomEntry'
import { BuildingEntry } from './components/entry/BuildingEntry'
import { LedgerView } from './features/ledger/LedgerView'
import { PropertiesView } from './features/properties/PropertiesView'
import { ReportsView } from './features/ReportsView'
import { propertiesRepo } from './lib/repositories'
import { useAppStore } from './state/useAppStore'
import type { Property } from './types'

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { loading, session } = useAuth()
  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }
  if (!session) return <LoginView />
  return <Shell />
}

function Shell() {
  const activeView = useAppStore((s) => s.activeView)
  const [properties, setProperties] = useState<Property[]>([])

  const loadProperties = useCallback(async () => {
    try {
      setProperties(await propertiesRepo.list())
    } catch {
      setProperties([])
    }
  }, [])

  useEffect(() => {
    void loadProperties()
  }, [loadProperties])

  // レポート系（表が広い）は枠を広く取る
  const wide =
    activeView === 'rentroll' ||
    activeView === 'summary' ||
    activeView === 'payments' ||
    activeView === 'prospectus' ||
    activeView === 'statusreport'

  return (
    <div className="min-h-full bg-slate-50 text-slate-800 pb-8">
      <Header />
      <PropertyTabs properties={properties} />
      <main className={(wide ? 'max-w-7xl' : 'max-w-3xl') + ' mx-auto px-5 py-5'}>
        {activeView === 'entry' && <EntryView properties={properties} />}
        {activeView === 'ledger' && <LedgerView properties={properties} />}
        {activeView === 'properties' && <PropertiesView onChanged={loadProperties} />}
        {(activeView === 'rentroll' ||
          activeView === 'summary' ||
          activeView === 'payments' ||
          activeView === 'prospectus' ||
          activeView === 'statusreport') && <ReportsView properties={properties} />}
      </main>
    </div>
  )
}

type EntryTab = 'room' | 'building'

function EntryView({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const [tab, setTab] = useState<EntryTab>('room')
  const [saved, setSaved] = useState(false)

  if (properties.length === 0) {
    return (
      <div className="text-center text-slate-500 text-sm py-12">
        まず物件を登録してください。
        <button
          onClick={() => setActiveView('properties')}
          className="block mx-auto mt-3 rounded-xl bg-slate-900 text-white px-4 py-2 font-medium hover:bg-slate-800"
        >
          物件の管理へ
        </button>
      </div>
    )
  }

  const onSaved = () => {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 4000)
  }

  return (
    <div className="space-y-4">
      {saved && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-3">
          <CheckCircle2 className="w-5 h-5" />
          記帳しました。
          <button onClick={() => setActiveView('ledger')} className="underline ml-1">
            台帳で確認
          </button>
        </div>
      )}

      <div className="flex rounded-xl bg-slate-100 p-1 text-sm">
        {(['room', 'building'] as EntryTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'flex-1 rounded-lg py-2 font-medium transition-colors ' +
              (tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')
            }
          >
            {t === 'room' ? '部屋ごと' : '建物まとめ'}
          </button>
        ))}
      </div>

      {tab === 'room' ? (
        <RoomEntry properties={properties} defaultPropertyId={activeProperty} onSaved={onSaved} />
      ) : (
        <BuildingEntry properties={properties} defaultPropertyId={activeProperty} onSaved={onSaved} />
      )}
    </div>
  )
}
