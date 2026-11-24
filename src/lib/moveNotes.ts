// 入退去で入金状況の備考に自動で書き足す文言。
//
// 運用：
//   ・退去月は退去する人の契約者名・満額を入れ、備考に「〇月〇日退去予定」と書く
//     （ユーザー指定 2026-09-30）
//   ・次の入居者の日割りは入居月に請求し、翌月から満額にする（ユーザー指定 2026-11-24）。
//     入居月の備考に「〇月〇日入居（日割り）」と書く
//
// 2026-09-30〜11-24 は「日割りは入居月に請求せず、翌月の家賃に上乗せ」で、翌月の備考に
// `[日割り 12345]` の目印、入居月の備考に「〇月〇日入居（日割りは〇月分に上乗せ）」を
// 付けていた。今は付けないが、残っている古い文言・目印は作り直しのたびにはがす。
// 備考は人が書く欄なので、自動の文言は毎回はがしてから付け直す（手書きの部分は残す）。

const PRORATED_RE = /\[日割り\s*(-?\d+)\]/g
const OUT_NOTE_RE = /\d{1,2}月\d{1,2}日退去(予定)?/g
// 今の文言「〇月〇日入居（日割り）」と、古い文言「…（日割りは〇月分に上乗せ）」の両方に当たる
const IN_NOTE_RE = /\d{1,2}月\d{1,2}日入居（日割り(?:は\d{1,2}月分に上乗せ)?）/g

const tidy = (s: string) => s.replace(/\s{2,}/g, ' ').trim()

/**
 * 備考に残っている古い目印 `[日割り N]` の額。無ければ0。
 * 古い方式で作られ、まだ作り直されていない記録を収支表が読むために残してある。
 */
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
  /** 入居日（入居月＝日割りを請求する月にだけ入れる） */
  inDate?: string | null
}

/** 自動の文言・目印が備考に入っているか */
export function hasMoveNotes(memo: string | null | undefined): boolean {
  const s = String(memo ?? '')
  return [PRORATED_RE, OUT_NOTE_RE, IN_NOTE_RE].some((re) => new RegExp(re.source).test(s))
}

/** 付ける文言があるか */
export const anyMoveNotes = (n: MoveNotes) => Boolean(n.outDate || n.inDate)

/** 自動の文言・目印をはがして、その月のぶんを付け直す */
export function writeMoveNotes(memo: string | null | undefined, notes: MoveNotes): string | null {
  const manual = tidy(
    String(memo ?? '').replace(PRORATED_RE, '').replace(OUT_NOTE_RE, '').replace(IN_NOTE_RE, ''),
  )
  const auto: string[] = []
  if (notes.outDate) auto.push(`${mdOf(notes.outDate)}退去${notes.outScheduled ? '予定' : ''}`)
  if (notes.inDate) auto.push(`${mdOf(notes.inDate)}入居（日割り）`)
  const out = tidy([...auto, manual].filter(Boolean).join(' '))
  return out === '' ? null : out
}
