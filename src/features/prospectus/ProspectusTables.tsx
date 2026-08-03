// 物件概要書のうち、DataTable で出す4タブ（運営費・修繕履歴・法定点検・引継書類）。
// 手本＝「台帳_プランドール守口.xlsx」の 運営費内訳／修繕費(専有部)(共用部)／
// 法定点検・維持管理／公的書類詳細 の各シート。
import type { ReactNode } from 'react'
import { DataTable, type FieldDef } from './DataTable'
import { yen, formatDate } from '../../lib/format'
import {
  OPEX_CATEGORIES, OPEX_CYCLES, INSPECTION_TARGETS, INSPECTION_JUDGEMENTS,
  DOCUMENT_STATUSES,
  type PropertyOpex, type PropertyRepair, type PropertyInspection, type PropertyDocument,
} from '../../types'

const money = (v: unknown) => (v == null || v === '' ? <span className="text-slate-300">—</span> : yen(Number(v)))
const date = (v: unknown) => (v ? formatDate(String(v)) : <span className="text-slate-300">—</span>)

// =====================================================================
// 運営費内訳
// =====================================================================
export function OpexTab({ rows, onSave, onRemove, propertyId }: TabProps<PropertyOpex>) {
  // 金額（月額・年額）は表に出さない。運営費の数字は収支表の実績を正としており、
  // 契約時の想定額を並べると2つの合計が並んで誤解を招くため。
  // データは残してあるので、編集モーダルでは今までどおり入力・確認できる。
  const fields: FieldDef<PropertyOpex>[] = [
    { key: 'category', label: '費目カテゴリ', type: 'select', options: OPEX_CATEGORIES, formOnly: true },
    { key: 'name', label: '費目名称' },
    { key: 'payee', label: '支払先' },
    { key: 'cycle', label: '支払サイクル', type: 'select', options: OPEX_CYCLES },
    { key: 'mandatory', label: '法定義務', align: 'center' },
    { key: 'note', label: '備考', type: 'textarea' },
    { key: 'monthly', label: '月額（円・参考）', type: 'number', formOnly: true },
    { key: 'annual', label: '年額（円・参考）', type: 'number', formOnly: true },
    { key: 'sort_order', label: '並び順', type: 'number', formOnly: true },
  ]

  return (
    <>
      <DataTable
        fields={fields}
        rows={rows}
        onSave={onSave}
        onRemove={onRemove}
        groupBy={(r) => r.category ?? 'その他'}
        defaults={{ property_id: propertyId, category: '管理費' }}
        addLabel="費目を追加"
        emptyText="支払先が登録されていません。「費目を追加」から入力してください。"
      />
      <p className="text-[11px] text-slate-400 mt-2">
        ※ 誰にいくらのサイクルで払っているかの一覧。金額は上の実績を正とするため表には出していない
        （編集画面では入力できる）。
      </p>
    </>
  )
}

// =====================================================================
// 修繕履歴（共用部・専有部の2表）
// =====================================================================
export function RepairsTab({ rows, onSave, onRemove, propertyId }: TabProps<PropertyRepair>) {
  return (
    <div className="space-y-6">
      {(['共用部', '専有部'] as const).map((scope) => (
        <RepairScope
          key={scope}
          scope={scope}
          rows={rows.filter((r) => r.scope === scope)}
          onSave={onSave}
          onRemove={onRemove}
          propertyId={propertyId}
        />
      ))}
    </div>
  )
}

function RepairScope({
  scope, rows, onSave, onRemove, propertyId,
}: TabProps<PropertyRepair> & { scope: string }) {
  const fields: FieldDef<PropertyRepair>[] = [
    { key: 'repaired_on', label: '修繕日付', type: 'date', render: (r) => date(r.repaired_on) },
    { key: 'kind', label: '分類' },
    { key: 'place', label: '修繕箇所' },
    { key: 'content', label: '修繕内容' },
    { key: 'vendor', label: '会社名' },
    { key: 'cost', label: '費用', type: 'number', align: 'right', render: (r) => money(r.cost) },
    {
      key: 'major', label: '大規模', type: 'checkbox', align: 'center',
      render: (r) => (r.major ? <span className="text-red-600 font-bold">大規模</span> : null),
    },
    { key: 'note', label: '備考', type: 'textarea' },
    { key: 'scope', label: '区分', type: 'select', options: ['共用部', '専有部'], formOnly: true },
  ]
  const total = rows.reduce((s, r) => s + Number(r.cost ?? 0), 0)
  const major = rows.filter((r) => r.major).reduce((s, r) => s + Number(r.cost ?? 0), 0)

  return (
    <div className="report-block">
      <div className="flex items-baseline justify-between border-b-2 border-slate-800 pb-1 mb-2">
        <h3 className="text-sm font-bold text-slate-700">{scope}修繕費</h3>
        <div className="text-xs text-slate-500">
          {rows.length}件・費用合計 <span className="font-bold text-slate-800">{yen(total)}</span>
          {major > 0 && <>（うち大規模改修 {yen(major)}）</>}
        </div>
      </div>
      <DataTable
        fields={fields}
        rows={rows}
        onSave={onSave}
        onRemove={onRemove}
        defaults={{ property_id: propertyId, scope, major: false }}
        addLabel={`${scope}の修繕を追加`}
        emptyText={`${scope}の修繕履歴が登録されていません。`}
      />
    </div>
  )
}

// =====================================================================
// 法定点検・維持管理
// =====================================================================
export function InspectionsTab({ rows, onSave, onRemove, propertyId }: TabProps<PropertyInspection>) {
  const fields: FieldDef<PropertyInspection>[] = [
    { key: 'item', label: '点検項目名' },
    { key: 'law', label: '根拠法令・条文' },
    { key: 'frequency', label: '頻度', align: 'center' },
    {
      key: 'target', label: '対象区分', type: 'select', options: INSPECTION_TARGETS, align: 'center',
      render: (r) => <TargetPill value={r.target} />,
    },
    { key: 'last_date', label: '前回実施日', type: 'date', render: (r) => date(r.last_date) },
    { key: 'next_date', label: '次回実施日', type: 'date', render: (r) => date(r.next_date) },
    {
      key: 'judgement', label: '判定', type: 'select', options: INSPECTION_JUDGEMENTS, align: 'center',
      render: (r) => <JudgePill value={r.judgement} />,
    },
    { key: 'vendor', label: '実施業者' },
    { key: 'note', label: '備考・指摘事項', type: 'textarea' },
    { key: 'category', label: 'カテゴリ', formOnly: true },
    { key: 'sort_order', label: '並び順', type: 'number', formOnly: true },
  ]
  const target = rows.filter((r) => r.target === '対象')
  const flagged = rows.filter((r) => r.judgement?.startsWith('△'))
  const needFix = rows.filter((r) => r.judgement?.startsWith('×'))

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <Stat label="点検対象" value={`${target.length} / ${rows.length} 項目`} />
        <Stat label="指摘あり" value={`${flagged.length} 項目`} tone={flagged.length ? 'warn' : undefined} />
        <Stat label="要修繕" value={`${needFix.length} 項目`} tone={needFix.length ? 'bad' : undefined} />
      </div>
      <DataTable
        fields={fields}
        rows={rows}
        onSave={onSave}
        onRemove={onRemove}
        groupBy={(r) => r.category ?? 'その他'}
        defaults={{ property_id: propertyId, target: '対象' }}
        addLabel="点検項目を追加"
        emptyText="法定点検が登録されていません。"
      />
      {(flagged.length > 0 || needFix.length > 0) && (
        <p className="text-[11px] text-slate-500 mt-2">
          ※ 指摘・要修繕は売買時の告知事項になる。既存不適格の内容は備考欄に残すこと。
        </p>
      )}
    </>
  )
}

// =====================================================================
// 引継書類（公的書類・特殊設備）
// =====================================================================
export function DocumentsTab({ rows, onSave, onRemove, propertyId }: TabProps<PropertyDocument>) {
  const docFields: FieldDef<PropertyDocument>[] = [
    { key: 'name', label: '書類名' },
    {
      key: 'status', label: '有無', type: 'select', options: DOCUMENT_STATUSES, align: 'center',
      render: (r) => <DocPill value={r.status} />,
    },
    { key: 'file_name', label: 'ファイル名・保管先' },
    { key: 'note', label: '備考', type: 'textarea' },
    { key: 'category', label: '区分', type: 'select', options: ['公的書類', '特殊設備'], formOnly: true },
    { key: 'sort_order', label: '並び順', type: 'number', formOnly: true },
  ]
  const eqFields: FieldDef<PropertyDocument>[] = [
    { key: 'name', label: '設備名' },
    { key: 'law', label: '根拠法令' },
    { key: 'requirement', label: '義務内容・頻度' },
    {
      key: 'status', label: '有無', type: 'select', options: DOCUMENT_STATUSES, align: 'center',
      render: (r) => <DocPill value={r.status} />,
    },
    { key: 'note', label: '備考', type: 'textarea' },
    { key: 'category', label: '区分', type: 'select', options: ['公的書類', '特殊設備'], formOnly: true },
    { key: 'sort_order', label: '並び順', type: 'number', formOnly: true },
  ]
  const docs = rows.filter((r) => r.category !== '特殊設備')
  const equip = rows.filter((r) => r.category === '特殊設備')

  return (
    <div className="space-y-6">
      <div className="report-block">
        <h3 className="text-sm font-bold text-slate-700 border-b-2 border-slate-800 pb-1 mb-2">
          公的書類・確認書類
        </h3>
        <DataTable
          fields={docFields}
          rows={docs}
          onSave={onSave}
          onRemove={onRemove}
          defaults={{ property_id: propertyId, category: '公的書類', status: '有' }}
          addLabel="書類を追加"
          emptyText="書類が登録されていません。"
        />
      </div>
      <div className="report-block">
        <h3 className="text-sm font-bold text-slate-700 border-b-2 border-slate-800 pb-1 mb-2">
          特殊設備（法定対象）
        </h3>
        <DataTable
          fields={eqFields}
          rows={equip}
          onSave={onSave}
          onRemove={onRemove}
          defaults={{ property_id: propertyId, category: '特殊設備' }}
          addLabel="設備を追加"
          emptyText="特殊設備が登録されていません。"
        />
      </div>
    </div>
  )
}

// =====================================================================
// 共通の小物
// =====================================================================
interface TabProps<T> {
  rows: T[]
  onSave: (row: Partial<T>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  propertyId: string
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  const color =
    tone === 'bad' ? 'bg-red-50 text-red-700 border-red-200'
    : tone === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-50 text-slate-700 border-slate-200'
  return (
    <div className={`rounded-lg border px-3 py-1.5 ${color}`}>
      <span className="text-[11px] opacity-70">{label}</span>{' '}
      <span className="text-sm font-bold">{value}</span>
    </div>
  )
}

function pill(text: string, cls: string): ReactNode {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{text}</span>
}

function TargetPill({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>
  if (value === '対象') return pill('対象', 'bg-slate-800 text-white')
  if (value === '非対象') return pill('非対象', 'bg-slate-100 text-slate-500')
  return pill('確認中', 'bg-amber-100 text-amber-700')
}

function JudgePill({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>
  if (value.startsWith('×')) return pill(value, 'bg-red-100 text-red-700')
  if (value.startsWith('△')) return pill(value, 'bg-amber-100 text-amber-700')
  return pill(value, 'bg-emerald-100 text-emerald-700')
}

function DocPill({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-300">—</span>
  if (value === '有') return pill('有', 'bg-emerald-100 text-emerald-700')
  if (value === '無') return pill('無', 'bg-red-100 text-red-700')
  return pill(value, 'bg-amber-100 text-amber-700')
}
