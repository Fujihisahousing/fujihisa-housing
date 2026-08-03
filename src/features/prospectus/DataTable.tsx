// 物件概要書の付随データ（公的書類・法定点検・運営費・修繕履歴）を出す共通テーブル。
// 4タブとも「一覧を表示する／1行ずつモーダルで編集する」だけなので、
// 列の定義（FieldDef）を渡すと表とフォームの両方を作るようにしてある。
//
// 列が多い表（法定点検は11列）でセルごとのインライン編集にすると印刷レイアウトが
// 崩れやすいので、表は読み取り専用にしてモーダルで編集する方式にした。
import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2, X, Loader2 } from 'lucide-react'

export interface FieldDef<T> {
  key: Extract<keyof T, string>
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea'
  options?: readonly string[]
  /** 表示時のカスタム描画。省略時は値をそのまま出す */
  render?: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** true にすると表には出さず、編集モーダルでだけ扱う */
  formOnly?: boolean
  /** th に付けるクラス（幅の指定など） */
  thClass?: string
}

interface Props<T extends { id: string }> {
  fields: FieldDef<T>[]
  rows: T[]
  onSave: (row: Partial<T>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  /** 行を帯でまとめる。同じ値が続くあいだ1つのグループにする（並び順は呼び出し側で揃えておく） */
  groupBy?: (row: T) => string
  /** 新規行の初期値 */
  defaults?: Partial<T>
  addLabel?: string
  emptyText?: string
  /** tbody の最後に足す合計行など */
  footer?: ReactNode
  /** 編集できないようにする（閲覧専用で出したいとき） */
  readOnly?: boolean
}

export function DataTable<T extends { id: string }>({
  fields, rows, onSave, onRemove, groupBy, defaults, addLabel = '行を追加',
  emptyText = 'データがありません。', footer, readOnly = false,
}: Props<T>) {
  const [editing, setEditing] = useState<Partial<T> | null>(null)
  const cols = fields.filter((f) => !f.formOnly)

  // 同じグループ名が続くあいだをひとまとまりにして、先頭行の前に帯を挟む
  const blocks: { group: string | null; rows: T[] }[] = []
  for (const r of rows) {
    const g = groupBy ? groupBy(r) : null
    const last = blocks[blocks.length - 1]
    if (last && last.group === g) last.rows.push(r)
    else blocks.push({ group: g, rows: [r] })
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-[11px] text-slate-500 border-b-2 border-slate-300">
              {cols.map((f) => (
                <th key={f.key} className={`py-1.5 pr-2 font-medium ${alignClass(f.align)} ${f.thClass ?? ''}`}>
                  {f.label}
                </th>
              ))}
              {!readOnly && <th className="no-print w-16" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + (readOnly ? 0 : 1)} className="py-6 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            )}
            {blocks.map((b, bi) => (
              <FragmentRows
                key={bi}
                block={b}
                cols={cols}
                readOnly={readOnly}
                onEdit={setEditing}
                onRemove={onRemove}
              />
            ))}
            {footer}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <button
          onClick={() => setEditing({ ...(defaults ?? {}) } as Partial<T>)}
          className="no-print mt-2 flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          <Plus className="w-3.5 h-3.5" /> {addLabel}
        </button>
      )}

      {editing && (
        <RowModal
          // RowModal は draft を useState の初期値でしか受け取らないので、
          // 別の行に切り替わったら key で作り直す（前の行の入力値が残らないように）
          key={editing.id ?? 'new'}
          fields={fields}
          row={editing}
          onClose={() => setEditing(null)}
          onSave={async (r) => {
            await onSave(r)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function FragmentRows<T extends { id: string }>({
  block, cols, readOnly, onEdit, onRemove,
}: {
  block: { group: string | null; rows: T[] }
  cols: FieldDef<T>[]
  readOnly: boolean
  onEdit: (r: T) => void
  onRemove: (id: string) => Promise<void>
}) {
  return (
    <>
      {block.group && (
        <tr>
          <td
            colSpan={cols.length + (readOnly ? 0 : 1)}
            className="bg-slate-100 text-slate-700 font-medium py-1 px-2 text-[11px]"
          >
            {block.group}
          </td>
        </tr>
      )}
      {block.rows.map((r) => (
        <tr key={r.id} className="border-b border-slate-100 align-top">
          {cols.map((f) => (
            <td key={f.key} className={`py-1.5 pr-2 ${alignClass(f.align)}`}>
              {f.render ? f.render(r) : defaultCell(r[f.key], f)}
            </td>
          ))}
          {!readOnly && (
            <td className="no-print py-1.5 whitespace-nowrap">
              <button onClick={() => onEdit(r)} className="p-1 text-slate-400 hover:text-slate-700" title="編集">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (confirm('この行を削除します。よろしいですか？')) void onRemove(r.id)
                }}
                className="p-1 text-slate-400 hover:text-red-600"
                title="削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </td>
          )}
        </tr>
      ))}
    </>
  )
}

function alignClass(a?: 'left' | 'right' | 'center') {
  return a === 'right' ? 'text-right tabular-nums' : a === 'center' ? 'text-center' : 'text-left'
}

function defaultCell(v: unknown, f: FieldDef<never>): ReactNode {
  if (v == null || v === '') return <span className="text-slate-300">—</span>
  if (f.type === 'checkbox') return v ? '✓' : ''
  if (f.type === 'number') return Number(v).toLocaleString('ja-JP')
  // 改行入りのテキスト（指摘事項など）は原本どおり折り返して出す
  return <span className="whitespace-pre-wrap">{String(v)}</span>
}

function RowModal<T extends { id: string }>({
  fields, row, onClose, onSave,
}: {
  fields: FieldDef<T>[]
  row: Partial<T>
  onClose: () => void
  onSave: (r: Partial<T>) => Promise<void>
}) {
  const [draft, setDraft] = useState<Partial<T>>(row)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
      setSaving(false)
    }
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sticky top-0 bg-white">
          <h3 className="font-bold text-slate-800 text-sm">{row.id ? '編集' : '新規追加'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs text-slate-500 mb-1">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  value={(draft[f.key] as string) ?? ''}
                  onChange={(e) => set(f.key, e.target.value || null)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white"
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={Boolean(draft[f.key])}
                  onChange={(e) => set(f.key, e.target.checked)}
                  className="w-4 h-4"
                />
              ) : f.type === 'textarea' ? (
                <textarea
                  value={(draft[f.key] as string) ?? ''}
                  onChange={(e) => set(f.key, e.target.value || null)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={(draft[f.key] as string | number) ?? ''}
                  onChange={(e) =>
                    set(f.key, f.type === 'number'
                      ? (e.target.value === '' ? null : Number(e.target.value))
                      : (e.target.value || null))
                  }
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              )}
            </div>
          ))}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 sticky bottom-0 bg-white">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 保存
          </button>
        </div>
      </div>
    </div>
  )
}
