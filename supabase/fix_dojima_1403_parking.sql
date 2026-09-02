-- プランドール堂島 1403号室の駐輪代300円を登録し、光熱費に入った300円を駐車・駐輪へ振り替える。
--
-- 【背景】
-- 堂島は入居者への光熱費請求が無い物件。それでも収支表の「光熱費（入居者負担）」に
-- 毎月300円が出ていた。正体は1403号（㈱マイプレイス）の駐輪代。
--   ・毎月の請求／入金は 169,300円 ＝ 賃料159,000 ＋ 共益費10,000 ＋ 300
--   ・ところが units.parking が空なので、レントロールの駐輪駐車に入らず、
--     収支表では「賃料＋共益費を超えた残り」として光熱費行へ流れていた
--     （paymentRecordsToTransactions の 賃料→共益費→駐車・駐輪→光熱費 の振り分け）。
-- rebuild_parking_from_kounetsu.sql で「部屋情報に駐輪代を入れてから再実行」と
-- 保留していた2件が、これで対象になる。
--
-- 【影響】
--   ・レントロールの駐輪駐車 合計 40,400 → 40,700（1403に300が付く）
--   ・収支表 光熱費（入居者負担）から毎月300円が消え、駐車・駐輪へ移る
--     （2025年9月〜。収入合計は変わらず、行の内訳だけが移る）
--   ・請求額（billedAmount）は 169,000 → 169,300 になり、実請求と一致する
-- rent_history 側の parking は触らない。物件概要書の過去年度レントロールが参照するため。
--
-- Supabase SQL Editor（Role=postgres）で実行。ブラウザの翻訳はオフにすること。
-- 何度流しても同じ結果になる。

begin;

-- 1) 1403号室に駐輪代を登録
update units u
   set parking = '￥300',
       notes   = coalesce(nullif(u.notes, ''), '駐輪')
  from properties p
 where p.id = u.property_id
   and p.name like '%堂島%'
   and u.room = '1403'
   and coalesce(u.parking, '') = '';

-- 2) 通帳取込で光熱費に入った300円を駐車・駐輪へ振り替える
--    （rebuild_parking_from_kounetsu.sql と同じ条件。契約の駐輪駐車額と一致する行だけ）
update transactions t
   set category = '駐車・駐輪'
  from units u, properties p
 where u.id = t.unit_id
   and p.id = t.property_id
   and p.name like '%堂島%'
   and u.room = '1403'
   and t.type = 'income'
   and t.deleted_at is null
   and t.category = '光熱費'
   and coalesce(replace((regexp_match(u.parking, '[0-9][0-9,]*'))[1], ',', '')::numeric, 0) > 0
   and t.amount = replace((regexp_match(u.parking, '[0-9][0-9,]*'))[1], ',', '')::numeric;

commit;

-- 確認用1：1403の部屋情報
-- select u.room, u.rent, u.kyoeki, u.parking, u.notes
--   from units u join properties p on p.id = u.property_id
--  where p.name like '%堂島%' and u.room = '1403';
--
-- 確認用2：堂島に残っている光熱費の記帳（0件になるはず）
-- select t.date, u.room, t.category, t.amount, t.memo
--   from transactions t join properties p on p.id = t.property_id
--   left join units u on u.id = t.unit_id
--  where p.name like '%堂島%' and t.category = '光熱費' and t.deleted_at is null
--  order by t.date;
