// 賃料履歴（rent_history）の書き換え方を決める純関数。
//
// 履歴は「開始月が新しいほど優先」の階段で、1行に 賃料・共益費・駐輪駐車 を持つ。
// 部屋の編集で「開始月〜終了月（空欄＝現在も継続）」を選んで金額を変えたとき、
// 以前は開始月に1行足すだけだった。そのため次の3つが起きて「物件詳細を直しても
// 反映されない」になっていた（道頓堀4F・6Fの共益費 2026-09-11）。
//   ・開始月より後ろにある行（例：2025年2月分〜 共益費0）がそのまま勝ち、変更が途中で切れる
//   ・変えていない項目まで入力欄の現在値で書くので、当時の賃料が今の賃料に化ける
//   ・保存し直すたびに同じ開始月の行が増える
//
// ここでは「変えた項目だけを、期間の中にある全部の行に当てる」。期間の外の行と、
// 変えていない項目には手を付けない。部屋の編集と入居の反映の両方から同じ規則で使う。
// 入出力を持たないこと（書き込みは lib/resync.ts の saveRentHistoryPlan）。
import type { RentHistory } from '../types'

export interface RentValues {
  rent: number
  kyoeki: number
  parking: string | null
}
export type RentField = keyof RentValues

export interface RentHistoryCreate extends RentValues {
  effective_date: string
}
export interface RentHistoryUpdate {
  id: string
  effective_date: string
  /** 変える前の値（確認メッセージ用） */
  before: RentValues
  patch: Partial<RentValues>
}
export interface RentHistoryPlan {
  creates: RentHistoryCreate[]
  updates: RentHistoryUpdate[]
  /** 同じ開始月に重なっていた行。最後に保存した1行を残して消す */
  removes: string[]
}

const dateOf = (h: Pick<RentHistory, 'effective_date'>) => String(h.effective_date).slice(0, 10)
const num = (v: unknown) => Number(v ?? 0) || 0
const valuesOf = (h: RentHistory): RentValues => ({
  rent: num(h.rent),
  kyoeki: num(h.kyoeki),
  parking: h.parking ?? null,
})

/** 'YYYY-MM-01' の前月1日 */
export function prevMonthDate(date: string): string {
  const [y, m] = date.slice(0, 10).split('-').map(Number)
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}

/** 'YYYY-MM-01' の翌月1日 */
export function nextMonthDate(date: string): string {
  const [y, m] = date.slice(0, 10).split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** 同じ開始月の行を1本にまとめる。残すのは後から作った行（＝最後に保存した内容） */
export function dedupeHistory(rows: RentHistory[]): { kept: RentHistory[]; removed: string[] } {
  const byDate = new Map<string, RentHistory>()
  const removed: string[] = []
  const byCreated = [...rows].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  )
  for (const h of byCreated) {
    const prev = byDate.get(dateOf(h))
    if (prev) removed.push(prev.id)
    byDate.set(dateOf(h), h)
  }
  const kept = [...byDate.values()].sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
  return { kept, removed }
}

/**
 * その日に効いている額。effectiveRentKyoeki（calc.ts）と同じ規則：
 * 開始日がその日以前で最も新しい行、無ければ最も古い行、履歴が無ければ fallback。
 */
export function valueAt(rows: RentHistory[], date: string, fallback: RentValues): RentValues {
  let best: RentHistory | null = null
  let oldest: RentHistory | null = null
  for (const h of rows) {
    const d = dateOf(h)
    if (d <= date && (!best || d > dateOf(best))) best = h
    if (!oldest || d < dateOf(oldest)) oldest = h
  }
  const hit = best ?? oldest
  return hit ? valuesOf(hit) : fallback
}

const sameValue = (field: RentField, a: RentValues[RentField], b: RentValues[RentField]) =>
  field === 'parking' ? (a ?? null) === (b ?? null) : num(a) === num(b)

export function planRentHistoryEdit(args: {
  history: RentHistory[]
  /** 履歴が1行も無いときに使う、改定前の部屋の値 */
  fallback: RentValues
  /** 変えた項目と新しい値。ここに無い項目は触らない */
  changed: Partial<RentValues>
  /** 'YYYY-MM-01'。この月分から */
  startDate: string
  /** 'YYYY-MM-01'。この月分まで。null なら現在も継続（後ろの行すべてに当てる） */
  endDate: string | null
  /** 改定前の額を置く日（契約開始月など）。開始月より前でなければ 2000-01-01 に置く */
  baseDate?: string | null
}): RentHistoryPlan {
  const { kept, removed } = dedupeHistory(args.history)
  const plan: RentHistoryPlan = { creates: [], updates: [], removes: removed }
  const fields = Object.keys(args.changed) as RentField[]
  if (fields.length === 0) return plan

  const start = args.startDate
  const revert = args.endDate ? nextMonthDate(args.endDate) : null
  const inRange = (d: string) => d >= start && (revert == null || d < revert)

  // 1) 改定前の額。開始月より前に行が無いと、開始月より前の月は「最も古い行」で
  //    計算されるので、新しい額が過去の月まで広がってしまう。
  //    その月まで実際に使われていた額（＝書き換える前の計算結果）を、開始月より前に置く。
  if (!kept.some((h) => dateOf(h) < start)) {
    const before = valueAt(kept, prevMonthDate(start), args.fallback)
    if (before.rent > 0 || before.kyoeki > 0 || before.parking) {
      const base = args.baseDate && args.baseDate.slice(0, 10) < start ? args.baseDate.slice(0, 10) : '2000-01-01'
      plan.creates.push({ effective_date: base, ...before })
    }
  }

  // 2) 終了月の翌月から、書き換える前にその月に効いていた額へ戻す。
  //    ちょうどその月に始まる行が既にあれば、そこで自然に切り替わるので足さない。
  if (revert && !kept.some((h) => dateOf(h) === revert)) {
    plan.creates.push({ effective_date: revert, ...valueAt(kept, revert, args.fallback) })
  }

  // 3) 開始月の行が無ければ作る。変えていない項目は、その月に効いていた額を引き継ぐ
  if (!kept.some((h) => dateOf(h) === start)) {
    plan.creates.push({ effective_date: start, ...valueAt(kept, start, args.fallback), ...args.changed })
  }

  // 4) 期間の中にある行（開始月の行を含む）へ、変えた項目だけを当てる
  for (const h of kept) {
    const d = dateOf(h)
    if (!inRange(d)) continue
    const cur = valuesOf(h)
    const patch: Partial<RentValues> = {}
    for (const f of fields) {
      if (!sameValue(f, cur[f], args.changed[f] as RentValues[RentField])) {
        ;(patch as Record<string, unknown>)[f] = args.changed[f]
      }
    }
    if (Object.keys(patch).length > 0) plan.updates.push({ id: h.id, effective_date: d, before: cur, patch })
  }
  return plan
}

/** 計画を当てたあとの履歴（保存前の確認と、部屋の現在値の計算に使う） */
export function applyRentHistoryPlan(history: RentHistory[], plan: RentHistoryPlan, unitId: string): RentHistory[] {
  const removed = new Set(plan.removes)
  const updates = new Map(plan.updates.map((u) => [u.id, u.patch]))
  const rows = history
    .filter((h) => !removed.has(h.id))
    .map((h) => ({ ...h, ...(updates.get(h.id) ?? {}) }))
  plan.creates.forEach((c, i) => rows.push({ id: `new-${i}`, unit_id: unitId, ...c }))
  return rows
}
