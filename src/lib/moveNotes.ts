// 入退去で入金状況の備考に自動で書き足す文言と、日割りの目印。
//
// 運用（2026-09-30 ユーザー指定）：
//   ・退去月は退去する人の契約者名・満額を入れ、備考に「〇月〇日退去予定」と書く
//   ・次の入居者の日割りは入居月に請求せず、翌月の家賃に上乗せして入金してもらう
// 翌月の請求額に上乗せした日割りは `[日割り 12345]` の目印で残す。収支表はこの目印を
// 見て日割りを家賃に数える（無いと「賃料＋共益費」を超えた分が光熱費に落ちる）。
// 備考は人が書く欄なので、自動の文言は毎回はがしてから付け直す（手書きの部分は残す）。

const PRORATED_RE = /\[日割り\s*(-?\d+)\]/g
const OUT_NOTE_RE = /\d{1,2}月\d{1,2}日退去(予定)?/g
const IN_NOTE_RE = /\d{1,2}月\d{1,2}日入居（日割りは\d{1,2}月分に上乗せ）/g

const tidy = (s: string) => s.replace(/\s{2,}/g, ' ').trim()

/** 請求額に上乗せしている日割りの額。無ければ0 */
export function readProratedTag(memo: string | null | undefined): number {
  let sum = 0
  for (const m of String(memo ?? '').matchAll(PRORATED_RE)) sum += Number(m[1]) || 0
  return sum
}

/** 'YYYY-MM-DD' → 「9月30日」 */
const mdOf = (date: string) => {
  const [, m, d] = date.slice(0, 10).split('-').map(Number)
  return `${m}月${d}日`
}

export interface MoveNotes {
  /** 退去日（実際の退去日が無ければ予定日）と、それが予定かどうか */
  outDate?: string | null
  outScheduled?: boolean
  /** 入居日と、日割りを上乗せする月（1〜12） */
  inDate?: string | null
  proratedToMonth?: number | null
  /** 翌月に上乗せした日割りの額（0 なら目印を付けない） */
  prorated?: number
}

/** 自動の文言・目印が備考に入っているか */
export function hasMoveNotes(memo: string | null | undefined): boolean {
  const s = String(memo ?? '')
  return [PRORATED_RE, OUT_NOTE_RE, IN_NOTE_RE].some((re) => new RegExp(re.source).test(s))
}

/** 付ける文言があるか */
export const anyMoveNotes = (n: MoveNotes) =>
  Boolean(n.outDate || (n.inDate && n.proratedToMonth) || (n.prorated && n.prorated > 0))

/** 自動の文言・目印をはがして、その月のぶんを付け直す */
export function writeMoveNotes(memo: string | null | undefined, notes: MoveNotes): string | null {
  const manual = tidy(
    String(memo ?? '').replace(PRORATED_RE, '').replace(OUT_NOTE_RE, '').replace(IN_NOTE_RE, ''),
  )
  const auto: string[] = []
  if (notes.outDate) auto.push(`${mdOf(notes.outDate)}退去${notes.outScheduled ? '予定' : ''}`)
  if (notes.inDate && notes.proratedToMonth)
    auto.push(`${mdOf(notes.inDate)}入居（日割りは${notes.proratedToMonth}月分に上乗せ）`)
  if (notes.prorated && notes.prorated > 0) auto.push(`[日割り ${notes.prorated}]`)
  const out = tidy([...auto, manual].filter(Boolean).join(' '))
  return out === '' ? null : out
}
