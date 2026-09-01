// repository層：UI・集計は必ずここ経由で DB にアクセスする（DB実装に依存させない）。
// RLS により、ログイン済みでないと読み書きできない。個人情報(leases)は admin のみ。
import { supabase } from './supabase'
import type { Property, Unit, Transaction, Setting, Profile, Lease, PaymentRecord, RentHistory, ArrearsNote, AuditLog, MoveEvent, MoveOutLedgerEntry } from '../types'
import type { PropertyDocument, PropertyInspection, PropertyOpex, PropertyRepair } from '../types'

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  return data as T
}

// Supabase/PostgREST は 1回のクエリで最大1000行しか返さない。
// 全件が必要な取得は 1000行ずつ range で辿って全ページ結合する。
//
// 【重要】makeQuery には必ず「一意に定まる並び順」を付けること。
// Postgres は ORDER BY の無い（または同順位のある）取得で行の順序を保証しない。
// 順序が揺れるとページの境目で行が重複したり抜け落ちたりする。しかも UPDATE した行は
// 物理位置が変わるので、1行直すたびに抜ける行が入れ替わる。
// 実際 payment_records（6,783行・堂島だけで2,745行）で、判定を1つ変えると無関係な
// 号室の請求額・判定まで一斉に変わる不具合になっていた（記録が抜けた行が自動計算に
// フォールバックするため）。同順位が出ないよう主キーまで並び順に含める。
const PAGE = 1000
async function fetchAllPages<T>(
  makeQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    const rows = unwrap(data, error) as T[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

// ---------------------------------------------------------------------
// properties（物件）
// ---------------------------------------------------------------------
export const propertiesRepo = {
  async list(): Promise<Property[]> {
    const { data, error } = await supabase.from('properties').select('*').order('created_at')
    return unwrap(data, error)
  },
  async get(id: string): Promise<Property | null> {
    const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle()
    return unwrap(data, error)
  },
  async create(p: Partial<Property>): Promise<Property> {
    const { data, error } = await supabase.from('properties').insert(p).select().single()
    return unwrap(data, error)
  },
  async update(id: string, patch: Partial<Property>): Promise<Property> {
    const { data, error } = await supabase.from('properties').update(patch).eq('id', id).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('properties').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// units（部屋）
// ---------------------------------------------------------------------
export const unitsRepo = {
  async listAll(): Promise<Unit[]> {
    const { data, error } = await supabase.from('units').select('*').order('room')
    return unwrap(data, error)
  },
  async listByProperty(propertyId: string): Promise<Unit[]> {
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('property_id', propertyId)
      .order('room')
    return unwrap(data, error)
  },
  /** 1件だけ取得。見つからなければ null（台帳→入金状況の反映で使う） */
  async getById(id: string): Promise<Unit | null> {
    const { data, error } = await supabase.from('units').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ?? null
  },
  async create(u: Partial<Unit>): Promise<Unit> {
    const { data, error } = await supabase.from('units').insert(u).select().single()
    return unwrap(data, error)
  },
  async update(id: string, patch: Partial<Unit>): Promise<Unit> {
    const { data, error } = await supabase.from('units').update(patch).eq('id', id).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('units').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// rent_history（賃料・共益費の履歴、反映開始日つき）
// ---------------------------------------------------------------------
export const rentHistoryRepo = {
  async listByUnitIds(unitIds: string[]): Promise<RentHistory[]> {
    if (unitIds.length === 0) return []
    const { data, error } = await supabase
      .from('rent_history')
      .select('*')
      .in('unit_id', unitIds)
      .order('effective_date', { ascending: false })
    return unwrap(data, error)
  },
  async listByUnit(unitId: string): Promise<RentHistory[]> {
    const { data, error } = await supabase
      .from('rent_history')
      .select('*')
      .eq('unit_id', unitId)
      .order('effective_date', { ascending: false })
    return unwrap(data, error)
  },
  async create(h: Partial<RentHistory>): Promise<RentHistory> {
    const { data, error } = await supabase.from('rent_history').insert(h).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('rent_history').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// arrears_notes（未入金一覧の保証会社対応メモ）
// ---------------------------------------------------------------------
export const arrearsNotesRepo = {
  async listByUnitIds(unitIds: string[]): Promise<ArrearsNote[]> {
    if (unitIds.length === 0) return []
    const { data, error } = await supabase.from('arrears_notes').select('*').in('unit_id', unitIds)
    return unwrap(data, error)
  },
  // 号室単位で保存（存在すれば更新、無ければ作成）。渡したフィールドだけ上書きする。
  async upsert(unitId: string, patch: Partial<ArrearsNote>): Promise<void> {
    const { error } = await supabase
      .from('arrears_notes')
      .upsert({ unit_id: unitId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'unit_id' })
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// transactions（入出金）
// ---------------------------------------------------------------------
export interface TxFilter {
  propertyId?: string | null // null/未指定 = 全体（合算）
  from?: string // 'YYYY-MM-DD'
  to?: string
}

export const transactionsRepo = {
  async list(filter: TxFilter = {}): Promise<Transaction[]> {
    return fetchAllPages<Transaction>(() => {
      // 論理削除(deleted_at)済みは除外
      // 同じ日付の記帳が多数あるので、id まで並べてページングの順序を確定させる
      let q = supabase
        .from('transactions')
        .select('*')
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .order('id')
      if (filter.propertyId) q = q.eq('property_id', filter.propertyId)
      if (filter.from) q = q.gte('date', filter.from)
      if (filter.to) q = q.lte('date', filter.to)
      return q
    })
  },
  async create(t: Partial<Transaction>): Promise<Transaction> {
    const { data, error } = await supabase.from('transactions').insert(t).select().single()
    return unwrap(data, error)
  },
  /** 複数件をまとめて記帳（部屋ごと・建物まとめ入力で使用） */
  async createMany(rows: Partial<Transaction>[]): Promise<Transaction[]> {
    if (rows.length === 0) return []
    const { data, error } = await supabase.from('transactions').insert(rows).select()
    return unwrap(data, error)
  },
  async update(id: string, patch: Partial<Transaction>): Promise<Transaction> {
    const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select().single()
    return unwrap(data, error)
  },
  /** 論理削除（物理削除しない）。deleted_at を付与し、監査ログには delete として残る。 */
  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// audit_logs（変更履歴・監査ログ）※閲覧は admin のみ（RLS）
// ---------------------------------------------------------------------
export const auditLogsRepo = {
  async listByRecord(tableName: string, recordId: string): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('table_name', tableName)
      .eq('record_id', recordId)
      .order('created_at', { ascending: false })
    return unwrap(data, error)
  },
}

// ---------------------------------------------------------------------
// payment_notes（入金状況の月別メモ）
// ---------------------------------------------------------------------
export const paymentNotesRepo = {
  /** 指定年月のメモを { unit_id: memo } のマップで取得 */
  async mapByMonth(year: number, month: number): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('payment_notes')
      .select('unit_id, memo')
      .eq('year', year)
      .eq('month', month)
    const rows = unwrap(data, error) as { unit_id: string; memo: string | null }[]
    const m: Record<string, string> = {}
    for (const r of rows) if (r.memo != null) m[r.unit_id] = r.memo
    return m
  },
  /** メモを保存（空なら削除） */
  async set(unitId: string, year: number, month: number, memo: string): Promise<void> {
    if (memo.trim() === '') {
      const { error } = await supabase
        .from('payment_notes')
        .delete()
        .eq('unit_id', unitId)
        .eq('year', year)
        .eq('month', month)
      if (error) throw new Error(error.message)
      return
    }
    const { error } = await supabase
      .from('payment_notes')
      .upsert({ unit_id: unitId, year, month, memo, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// payment_records（入金状況の月次記録）
// ---------------------------------------------------------------------
export const paymentRecordsRepo = {
  /** 物件の月次記録を取得（propertyId=null は全件） */
  async list(propertyId: string | null): Promise<PaymentRecord[]> {
    return fetchAllPages<PaymentRecord>(() => {
      // 主キー（property_id, room, year, month）順に並べてページングの順序を確定させる
      let q = supabase
        .from('payment_records')
        .select('*')
        .order('property_id')
        .order('room')
        .order('year')
        .order('month')
      if (propertyId) q = q.eq('property_id', propertyId)
      return q
    })
  },
  /** 備考を更新 */
  async setMemo(
    property_id: string,
    room: string,
    year: number,
    month: number,
    memo: string,
  ): Promise<void> {
    const { error } = await supabase
      .from('payment_records')
      .update({ memo, updated_at: new Date().toISOString() })
      .match({ property_id, room, year, month })
    if (error) throw new Error(error.message)
  },
  /** 月次記録を作成/更新（手入力用）。キー=property_id+room+year+month */
  async upsert(rec: PaymentRecord): Promise<void> {
    const { error } = await supabase
      .from('payment_records')
      .upsert(
        { ...rec, updated_at: new Date().toISOString() },
        { onConflict: 'property_id,room,year,month' },
      )
    if (error) throw new Error(error.message)
  },
  /**
   * この号室の、指定年月以降の月次記録を取得する。賃料履歴を変更したときに
   * 請求額を貼り直す対象を拾うのに使う。
   */
  async listFrom(
    property_id: string,
    room: string,
    year: number,
    month: number,
  ): Promise<PaymentRecord[]> {
    const { data, error } = await supabase
      .from('payment_records')
      .select('*')
      .match({ property_id, room })
      // (year, month) >= (year, month) を1本の条件で書けないので、
      // 「翌年以降」または「同年かつ当月以降」で拾う
      .or(`year.gt.${year},and(year.eq.${year},month.gte.${month})`)
    return unwrap(data, error)
  },
  /** 請求額と判定だけを差し替える（入金額・契約者名・備考には触らない） */
  /** 請求額だけを1か月ぶん書き込む。記録が無ければ作る。
   *  setBilled と違って判定は触らない（入退去シートの例外月＝入居月の日割り・退去月の満額に使う）。
   *  upsert は渡した列だけを更新するので、入金額やメモなど既存の値は消えない。 */
  async upsertBilled(
    property_id: string,
    room: string,
    year: number,
    month: number,
    billed: number,
  ): Promise<void> {
    const { error } = await supabase
      .from('payment_records')
      .upsert(
        { property_id, room, year, month, billed, updated_at: new Date().toISOString() },
        { onConflict: 'property_id,room,year,month' },
      )
    if (error) throw new Error(error.message)
  },

  async setBilled(
    property_id: string,
    room: string,
    year: number,
    month: number,
    billed: number,
    judgement: string,
  ): Promise<void> {
    const { error } = await supabase
      .from('payment_records')
      .update({ billed, judgement, updated_at: new Date().toISOString() })
      .match({ property_id, room, year, month })
    if (error) throw new Error(error.message)
  },
  /**
   * 部屋詳細で契約者情報を入力・更新したときに呼ぶ。この号室の月次記録のうち
   * 「契約者名が未入力（null/空文字）」のものだけ、契約者名・属性・読み方を
   * 埋める。既に契約者名が入っている記録（前の入居者の分など）は一切触らない
   * ——過去の履歴を保護するのと同じ理由。
   */
  async fillMissingTenant(
    property_id: string,
    room: string,
    tenant: string | null,
    tenant_type: string | null,
    kana: string | null,
  ): Promise<void> {
    if (!tenant) return
    const patch = { tenant, tenant_type, kana, updated_at: new Date().toISOString() }
    // null と 空文字 は別条件として2回に分けて更新する（.or() の文字列構文より
    // .is() / .eq() の方が確実で、意図しない行まで拾う心配が無い）
    const { error: e1 } = await supabase
      .from('payment_records')
      .update(patch)
      .match({ property_id, room })
      .is('tenant', null)
    if (e1) throw new Error(e1.message)
    const { error: e2 } = await supabase
      .from('payment_records')
      .update(patch)
      .match({ property_id, room })
      .eq('tenant', '')
    if (e2) throw new Error(e2.message)
  },

  /**
   * 部屋の契約者名を書き換えたときに、入金状況の月次記録の契約者名をそろえる。
   *
   * 月次記録は「その月の控え」なので原則あとから書き換えない（過去の入居者の名前を
   * 守るため）。ただし今入居している契約者の名前を直したときだけは、その契約の
   * 期間ぶんも直したい——「パナソニック」を「株式会社パナソニック」にしたのに
   * 入金状況が古い表記のまま、という食い違いを無くすのが狙い。
   *
   * 対象は「入居開始日(contract_start)の年月以降」の記録だけ。それより前は前の入居者の
   * 記録なので絶対に触らない。表記ゆれ（㈱／（）の全角半角など）があっても期間で切るので
   * まとめてそろう。入居開始日が未入力の部屋は期間を切れないので何もしない
   * （呼び出し側で renameTenant を使う）。
   *
   * @returns 書き換えた記録の件数
   */
  async syncTenantFrom(
    property_id: string,
    room: string,
    year: number,
    month: number,
    tenant: string,
    tenant_type: string | null,
    kana: string | null,
  ): Promise<number> {
    const { data, error } = await supabase
      .from('payment_records')
      .update({ tenant, tenant_type, kana, updated_at: new Date().toISOString() })
      .match({ property_id, room })
      // (year, month) >= (year, month) を1本の条件で書けないので、
      // 「翌年以降」または「同年かつ当月以降」で拾う（listFrom と同じ書き方）
      .or(`year.gt.${year},and(year.eq.${year},month.gte.${month})`)
      .select('id')
    if (error) throw new Error(error.message)
    return (data ?? []).length
  },

  /**
   * 前の契約者名がそのまま残っている記録だけを新しい名前に差し替える。
   * 入居開始日が未入力で期間を切れない部屋の受け皿。名前が一致した記録しか触らないので、
   * 別人の記録を巻き込む心配は無い。
   *
   * @returns 書き換えた記録の件数
   */
  async renameTenant(
    property_id: string,
    room: string,
    from: string,
    to: string,
    tenant_type: string | null,
    kana: string | null,
  ): Promise<number> {
    if (!from || from === to) return 0
    const { data, error } = await supabase
      .from('payment_records')
      .update({ tenant: to, tenant_type, kana, updated_at: new Date().toISOString() })
      .match({ property_id, room, tenant: from })
      .select('id')
    if (error) throw new Error(error.message)
    return (data ?? []).length
  },
}

// ---------------------------------------------------------------------
// settings（key/value）
// ---------------------------------------------------------------------
export const settingsRepo = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle()
    const row = unwrap(data, error) as { value: T } | null
    return row ? row.value : null
  },
  async set(key: string, value: unknown): Promise<void> {
    const { error } = await supabase.from('settings').upsert({ key, value } as Setting)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// profiles（役割）
// ---------------------------------------------------------------------
export const profilesRepo = {
  async getMine(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .eq('id', userId)
      .maybeSingle()
    return unwrap(data, error)
  },
}

// ---------------------------------------------------------------------
// leases（入居履歴・個人情報）— 暗号化/復号は必ずサーバ側 RPC 経由（admin のみ）
//   実際の入退去 UI は M3 で実装する。ここは基盤として用意。
// ---------------------------------------------------------------------
// leases RPC へ渡すペイロード（値は文字列でも数値でも可。サーバ側でパース）
export type LeasePayload = Record<string, string | number | null | undefined>

/** 入退去シート。個人情報を持たないので leases と違って暗号化RPCを通さず素で読み書きする */
export const moveEventsRepo = {
  /** 物件の入退去を新しい順で取得。号室は units 側から引くので unit_id で束ねて使う */
  async listByUnitIds(unitIds: string[]): Promise<MoveEvent[]> {
    if (unitIds.length === 0) return []
    const { data, error } = await supabase
      .from('move_events')
      .select('*')
      .in('unit_id', unitIds)
      .order('actual_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    return unwrap(data, error)
  },
  async save(row: Partial<MoveEvent> & { unit_id: string; kind: string }): Promise<MoveEvent> {
    const { data, error } = row.id
      ? await supabase.from('move_events').update(row).eq('id', row.id).select().single()
      : await supabase.from('move_events').insert(row).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('move_events').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

/** 退去帳簿（転居先住所）。個人情報なので暗号化・復号はサーバ側の RPC に任せる。
 *  admin 以外が呼んでも読みは空・書きは例外になる（画面側で欄を出さない前提）。 */
export const moveOutLedgerRepo = {
  /** 退去タブは全物件を横断するので unit_id の配列でまとめて引く（復号済み）。
   *  読めなかったときは空で返す：supabase/add_move_out_ledger.sql をまだ流していない本番でも
   *  退去タブそのものは開けるようにするため（住所を書こうとした時点でエラーが出る）。 */
  async listByUnitIds(unitIds: string[]): Promise<MoveOutLedgerEntry[]> {
    if (unitIds.length === 0) return []
    const { data, error } = await supabase.rpc('move_out_ledger_for_units', { p_unit_ids: unitIds })
    if (error) {
      console.warn('退去帳簿を読めませんでした（add_move_out_ledger.sql 未適用？）:', error.message)
      return []
    }
    return (data ?? []) as MoveOutLedgerEntry[]
  },
  /** 退去の記録1件につき1行を作る／上書きする。
   *  控え（物件名・号室・契約者名・日付・最終請求月・メモ）はサーバ側で move_events から
   *  取り直すので渡さない。🔒項目は渡したものだけ差し替わる——一覧で連絡先だけ直しても
   *  転居先住所が消えないようにするため。空文字を渡せばその項目だけ消える。 */
  async save(
    moveEventId: string,
    pii: { forwarding_address?: string | null; contact?: string | null } = {},
  ): Promise<void> {
    const p: Record<string, string> = { move_event_id: moveEventId }
    if (pii.forwarding_address !== undefined) p.forwarding_address = pii.forwarding_address ?? ''
    if (pii.contact !== undefined) p.contact = pii.contact ?? ''
    const { error } = await supabase.rpc('move_out_ledger_save', { p })
    if (error) throw new Error(error.message)
  },
}

export const leasesRepo = {
  /** 号室の入居履歴を「復号済み」で取得（admin 以外は空配列） */
  async listByUnit(unitId: string): Promise<Lease[]> {
    const { data, error } = await supabase.rpc('leases_for_unit', { p_unit_id: unitId })
    return unwrap(data, error)
  },
  // RPC は jsonb を受け取り、数値・日付はサーバ側で文字列からパースする。
  // そのため payload は文字列値も許容する緩い型にする。
  /** 入居履歴を作成（🔒列はサーバ側で暗号化） */
  async create(payload: LeasePayload): Promise<string> {
    const { data, error } = await supabase.rpc('lease_create', { p: payload })
    return unwrap(data, error)
  },
  /** 退去処理（転居先は暗号化、pii_purge_at は保持年数から自動計算） */
  async end(payload: LeasePayload & { id: string }): Promise<void> {
    const { error } = await supabase.rpc('lease_end', { p: payload })
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// 接続確認（M0 から継続利用）
// ---------------------------------------------------------------------
export async function pingSupabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { error } = await supabase.from('properties').select('id').limit(1)
    if (!error) return { ok: true, detail: 'properties に到達（テーブルあり）' }
    if (error.code === '42P01' || /relation .* does not exist/i.test(error.message)) {
      return { ok: true, detail: 'サーバー接続OK（schema.sql 未適用）' }
    }
    return { ok: true, detail: `サーバー応答あり: ${error.message}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------
// 物件概要書（売買資料）の付随データ
// 4テーブルとも「property_id で引く／1行ずつ保存・削除」しかしないので、
// 同じ形のリポジトリを1つのファクトリから作る。
// ---------------------------------------------------------------------
interface PropertyChild {
  id: string
  property_id: string
  sort_order?: number | null
}

function propertyChildRepo<T extends PropertyChild>(table: string, orderBy: string) {
  return {
    async listByProperty(propertyId: string): Promise<T[]> {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('property_id', propertyId)
        .order(orderBy, { nullsFirst: false })
      return unwrap(data, error)
    },
    /** id があれば更新、無ければ作成。渡したフィールドだけ書き換える。 */
    async save(row: Partial<T> & { property_id: string }): Promise<T> {
      const patch = { ...row, updated_at: new Date().toISOString() }
      if (row.id) {
        const { id, ...rest } = patch as Record<string, unknown> & { id: string }
        const { data, error } = await supabase.from(table).update(rest).eq('id', id).select().single()
        return unwrap(data, error)
      }
      const { data, error } = await supabase.from(table).insert(patch).select().single()
      return unwrap(data, error)
    },
    async remove(id: string): Promise<void> {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  }
}

/** 公的書類・特殊設備の有無 */
export const propertyDocumentsRepo = propertyChildRepo<PropertyDocument>('property_documents', 'sort_order')
/** 法定点検・維持管理スケジュール */
export const propertyInspectionsRepo = propertyChildRepo<PropertyInspection>('property_inspections', 'sort_order')
/** 年間運営費内訳 */
export const propertyOpexRepo = propertyChildRepo<PropertyOpex>('property_opex', 'sort_order')
/** 修繕履歴の明細。新しい修繕が上に来るよう日付の降順で返す */
export const propertyRepairsRepo = propertyChildRepo<PropertyRepair>('property_repairs', 'repaired_on')
