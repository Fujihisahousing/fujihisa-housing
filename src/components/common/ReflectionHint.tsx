// 金額を入力する画面で「その金額がどの月に出るか」を1行で示す。
//
// 同じ入金でも出る月が2系統で違うため、入力時に迷いやすい：
//   収支表・支出表 … 入金日ベース（通帳の動きどおり）。6/30 の記帳は6月。
//   入金状況       … 前家賃ベース（帰属月）。11日以降の入金は翌月分。6/30 は7月分。
// この食い違いを入力欄のそばに出しておく。
import { attributionMonth, ledgerMonth } from '../../lib/calc'

const ym = (v: { year: number; month: number }) => `${v.year}年${v.month}月`

export function ReflectionHint({
  date,
  /** 入金状況にも出るか。号室の紐づかない記帳（建物まとめ）は出ないので false */
  toPayments = true,
}: {
  date: string
  toPayments?: boolean
}) {
  if (!date) return null
  const led = ledgerMonth(date)
  if (!led.year) return null
  const attr = attributionMonth(date)
  const sameMonth = led.year === attr.year && led.month === attr.month

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
      <span>
        収支表・支出表 <b className="font-semibold text-slate-700">{ym(led)}</b>
      </span>
      {toPayments && (
        <>
          <span className="text-slate-300">／</span>
          <span>
            入金状況 <b className="font-semibold text-slate-700">{ym(attr)}分</b>
          </span>
          {!sameMonth && (
            <span className="text-slate-400">（11日以降の入金は翌月分の前家賃）</span>
          )}
        </>
      )}
    </p>
  )
}
