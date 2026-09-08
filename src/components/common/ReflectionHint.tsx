// 金額を入力する画面で「その金額がどの月に出るか」を1行で示す。
//
// 同じ入金でも出る月が2系統で違うため、入力時に迷いやすい：
//   収支表・支出表 … 入金日ベース（通帳の動きどおり）。6/30 の記帳は6月。
//   入金状況       … 前家賃ベース（帰属月）。11日以降の入金は翌月分。6/30 は7月分。
// この食い違いを入力欄のそばに出しておく。
//
// onPick を渡すと、収支表・支出表に載る月をその場で選べるようになる。日付だけでは
// 「何月分か」を決められない支払いがあるため（月末に翌月分を払う借入返済など。
// 8/31の支払いが8月分なのか9月分なのかは日付からは分からない）。選ばなければ
// 従来どおり日付から自動で決める。選んだ月は transactions.accounting_ym に入る。
import { addMonths, attributionMonth, ledgerMonth, parseYm, ymString } from '../../lib/calc'

const ym = (v: { year: number; month: number }) => `${v.year}年${v.month}月`

export function ReflectionHint({
  date,
  /** 入金状況にも出るか。号室の紐づかない記帳（建物まとめ）は出ないので false */
  toPayments = true,
  /** 収支表・支出表に載る月の手動指定（'YYYY-MM'）。null なら日付から自動 */
  accountingYm = null,
  /** 渡すと月を選べるようになる。null で「日付から自動」に戻す */
  onPick,
}: {
  date: string
  toPayments?: boolean
  accountingYm?: string | null
  onPick?: (v: string | null) => void
}) {
  if (!date) return null
  const led = ledgerMonth(date)
  if (!led.year) return null
  const attr = attributionMonth(date)
  const sameMonth = led.year === attr.year && led.month === attr.month
  const picked = parseYm(accountingYm)
  // 自動で決まる月（＝収入は帰属月、支出は暦月）。選択肢はこの前後1か月から出す
  const auto = toPayments ? attr : led
  const shown = picked ?? auto
  const options = [addMonths(auto, -1), auto, addMonths(auto, 1)]

  return (
    <div className="mt-1 space-y-0.5 text-xs text-slate-500">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span>
          収支表・支出表{' '}
          <b className={picked ? 'font-semibold text-slate-900' : 'font-semibold text-slate-700'}>
            {ym(shown)}
          </b>
          {picked && <span className="ml-1 text-slate-400">（指定）</span>}
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

      {onPick && (
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400">何月分にするか：</span>
          {options.map((o) => {
            const v = ymString(o)
            const isAuto = o.year === auto.year && o.month === auto.month
            const on = picked ? ymString(picked) === v : isAuto
            return (
              <button
                key={v}
                type="button"
                // 自動と同じ月を選んだら指定を外す（null に戻す）。余計な値を残さない
                onClick={() => onPick(isAuto ? null : v)}
                className={`rounded border px-1.5 py-0.5 ${
                  on
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {o.month}月{isAuto && <span className="ml-0.5 opacity-70">（自動）</span>}
              </button>
            )
          })}
          {toPayments && picked && (
            <span className="text-slate-400">※入金状況の「何月分」は変わりません</span>
          )}
        </p>
      )}
    </div>
  )
}
