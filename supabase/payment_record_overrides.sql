-- 入金状況の月次記録（payment_records）を「マスタからの自動導出＋手動上書き」に変える。
--
-- これまでの設計：記録がある月は物件情報を一切参照しない「その月の控え」だった。
--   → 部屋の編集・賃料履歴・入退去を直しても、記録がある月の表示は変わらなかった。
--     （「どこを直しても連動しない」の根本原因）
--
-- これから：契約者名・請求額・判定などはマスタ（units / rent_history / move_events /
--   transactions）から毎回作り直す。手で直した値だけを overrides に残して、作り直しの
--   対象から外す。
--
--   overrides の例： {"billed": 63000, "judgement": "保証会社請求中"}
--   キーは billed / paid / paid_on / tenant / tenant_type / kana / guarantor /
--   judgement / arrears_months のいずれか。memo と arrears_months はもともと
--   手入力しか入らないので、overrides に無くても作り直しでは触らない。
--
-- ■ 実行前に payment_records のバックアップを取ること（下の select をCSVで保存）。
--   select * from payment_records order by property_id, room, year, month;

alter table payment_records
  add column if not exists overrides jsonb not null default '{}'::jsonb;

comment on column payment_records.overrides is
  '手で確定した値だけを入れる。ここにあるキーは自動の作り直しで上書きしない';

-- ------------------------------------------------------------------
-- 既存データの引き継ぎ
-- ------------------------------------------------------------------
-- 判定（入金済・一部入金・未入金・保証会社請求中・空室）はどれも請求額と入金額から
-- 自動で決まるので、ここでは固定しない。手で選び直した判定は、その時点で overrides に入る。

-- 滞納月数の手入力は保護する（自動計算値と区別が付かなくなるため）。
update payment_records
   set overrides = overrides || jsonb_build_object('arrears_months', arrears_months)
 where arrears_months is not null
   and not (overrides ? 'arrears_months');

-- 入金額（paid）は「台帳の記帳から作り直せない額＝手入力」だけを保護したいが、
-- それはSQLでは判定できないので、アプリ側の再計算が初回に見分けて overrides に移す。
-- （記帳が1件も無いのに入金額が入っている月＝手入力とみなす）

select count(*) as 上書き登録件数 from payment_records where overrides <> '{}'::jsonb;
