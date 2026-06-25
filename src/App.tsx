import { useCallback, useEffect, useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoginView } from './auth/LoginView'
import { Header } from './components/layout/Header'
import { PropertyTabs } from './components/layout/PropertyTabs'
import { BottomNav } from './components/layout/BottomNav'
import { EntryGrid } from './components/entry/EntryGrid'
import { EntrySheet, type EntryTarget } from './components/entry/EntrySheet'
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

  return (
    <div className="min-h-full bg-slate-50 text-slate-800 pb-20">
      <Header />
      <PropertyTabs properties={properties} />
      <main className="max-w-3xl mx-auto px-5 py-5">
        {activeView === 'entry' && <EntryView properties={properties} />}
        {activeView === 'ledger' && <LedgerView properties={properties} />}
        {activeView === 'properties' && <PropertiesView onChanged={loadProperties} />}
        {(activeView === 'rentroll' ||
          activeView === 'summary' ||
          activeView === 'payments' ||
          activeView === 'prospectus') && <ReportsView properties={properties} />}
      </main>
      <BottomNav />
    </div>
  )
}

function EntryView({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const [target, setTarget] = useState<EntryTarget | null>(null)
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

  return (
    <div>
      {saved && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-3">
          <CheckCircle2 className="w-5 h-5" />
          記帳しました。
          <button onClick={() => setActiveView('ledger')} className="underline ml-1">
            台帳で確認
          </button>
        </div>
      )}
      <EntryGrid onPick={(type, category) => setTarget({ type, category })} />
      <EntrySheet
        target={target}
        properties={properties}
        defaultPropertyId={activeProperty}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null)
          setSaved(true)
          window.setTimeout(() => setSaved(false), 4000)
        }}
      />
    </div>
  )
}
