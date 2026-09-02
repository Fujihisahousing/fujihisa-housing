-- RentBook スキーマ（SOW 付録C）
-- Supabase の SQL Editor に貼り付けて実行する。
-- 適用は M1（スキーマ＋認証＋権限）で行う。M0 では未適用でも起動確認は可能。

-- 拡張
create extension if not exists "pgcrypto";

-- 物件
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text, access text, type text, structure text, built text,
  land_area numeric, building_area numeric, zoning text,
  bcr numeric, far numeric, road text, parking text,
  acquired_date date, acquired_price numeric, sale_price numeric, loan_balance numeric,
  notes text,
  -- レントロール全体タブでのグループ名。null なら物件単独で表示。
  -- 例：戸建ての6現場（豊野町/東中浜/大庭町/五月田町/滝井元町/東大阪松原）は
  --     別物件として扱いつつ、全体では '戸建て賃貸' の帯にまとまる
  group_name text,
  -- 決済日（売却の決済日）。設定すると決済後に現況報告書→レントロールの順で
  -- 一覧から自動的に消える。DBのデータは消さないので過去の収支表・入金状況は残る。
  disposed_date date,
  created_at timestamptz default now()
);

-- 部屋
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  room text, layout text, area numeric,
  use_type text, tenant_type text,
  rent numeric default 0, kyoeki numeric default 0,
  deposit numeric default 0, key_money numeric default 0,
  refund numeric, parking text,
  status text default '空室', tenant text, guarantor text, payment_method text,
  contract_start date, contract_end date, notes text, created_at timestamptz default now()
);

-- 既存環境向け（冪等）：上記4列を後付けする場合
alter table units add column if not exists use_type text;
alter table units add column if not exists tenant_type text;
alter table units add column if not exists refund numeric;
alter table units add column if not exists parking text;
alter table units add column if not exists hoshokin numeric;    -- 保証金
alter table units add column if not exists kaiyakubiki numeric; -- 解約引
alter table units add column if not exists tenant_kana text;    -- 契約者名の読み（カナ）
alter table units add column if not exists sort_order numeric;   -- 表示順（小さいほど上）
alter table units add column if not exists variation text;      -- 変動値（家賃変動・テキスト自由入力）

-- 賃料・共益費の履歴（反映開始日つき）。過去からの売上比較のため、部屋編集で賃料/共益費を
-- 変更するたびに1行追加する。ある年月時点の実効値＝effective_date が その年月以前で最大の行。
-- 履歴が無い部屋は units.rent/kyoeki（現在値）にフォールバックする。
create table if not exists rent_history (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete cascade,
  effective_date date not null,
  rent numeric not null default 0,
  kyoeki numeric not null default 0,
  created_at timestamptz default now()
);
create index if not exists rent_history_unit_date_idx on rent_history(unit_id, effective_date);
alter table rent_history enable row level security;
drop policy if exists "auth all rent_history" on rent_history;
create policy "auth all rent_history" on rent_history for all to authenticated using (true) with check (true);

-- 入金状況の月別メモ
create table if not exists payment_notes (
  unit_id uuid references units(id) on delete cascade,
  year int not null,
  month int not null,
  memo text,
  updated_at timestamptz default now(),
  primary key (unit_id, year, month)
);
alter table payment_notes enable row level security;
drop policy if exists "auth all payment_notes" on payment_notes;
create policy "auth all payment_notes" on payment_notes for all to authenticated using (true) with check (true);

-- 未入金一覧の保証会社対応メモ（号室単位）。保証会社から入る予定額・報告済フラグ・備考。
create table if not exists arrears_notes (
  unit_id uuid primary key references units(id) on delete cascade,
  expected_from_guarantor numeric,
  reported boolean not null default false,
  memo text,
  updated_at timestamptz default now()
);
alter table arrears_notes enable row level security;
drop policy if exists "auth all arrears_notes" on arrears_notes;
create policy "auth all arrears_notes" on arrears_notes for all to authenticated using (true) with check (true);

-- 入金状況の月次入金記録（手動データ）
create table if not exists payment_records (
  property_id uuid references properties(id) on delete cascade,
  room text not null,
  year int not null,
  month int not null,
  tenant text, tenant_type text, kana text,
  billed numeric, paid numeric, paid_on date,
  judgement text, guarantor text, memo text,
  updated_at timestamptz default now(),
  primary key (property_id, room, year, month)
);
-- 手で直した値だけを入れる箱。ここにあるキーはマスタからの作り直しで上書きしない
-- （詳しくは supabase/payment_record_overrides.sql と src/lib/derive.ts）
alter table payment_records add column if not exists overrides jsonb not null default '{}'::jsonb;
-- 滞納月数の手入力（null なら自動計算）
alter table payment_records add column if not exists arrears_months int;
alter table payment_records enable row level security;
drop policy if exists "auth all payment_records" on payment_records;
create policy "auth all payment_records" on payment_records for all to authenticated using (true) with check (true);

-- 入出金
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  property_id uuid references properties(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  type text not null check (type in ('income','expense')),
  category text not null,
  amount numeric not null default 0,
  method text, status text, memo text, created_at timestamptz default now(),
  deleted_at timestamptz  -- 論理削除（NULLでない＝削除済み。会計データは物理削除しない）
);
alter table transactions add column if not exists deleted_at timestamptz;

-- 監査ログ（変更履歴）：台帳(transactions)の作成・変更・削除を自動記録。detail に old/new を保存。
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,            -- insert / update / delete
  actor uuid,                      -- 変更者（auth.uid()）
  actor_email text,                -- 変更者メール（記録時点）
  detail jsonb,                    -- { "old": {...}, "new": {...} }
  created_at timestamptz default now()
);
create index if not exists idx_audit_logs_record on audit_logs(table_name, record_id, created_at desc);
alter table audit_logs enable row level security;
drop policy if exists "audit_logs admin read" on audit_logs;
create policy "audit_logs admin read" on audit_logs for select to authenticated using (is_admin());

-- 監査トリガ：old/new を detail(jsonb) に記録。論理削除(deleted_at 付与)は delete として記録。
create or replace function log_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_action text;
  v_record_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  select email into v_email from public.profiles where id = v_actor;
  if (TG_OP = 'INSERT') then
    v_action := 'insert'; v_record_id := NEW.id;
    v_old := null; v_new := to_jsonb(NEW);
  elsif (TG_OP = 'UPDATE') then
    v_record_id := NEW.id;
    v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    if (OLD.deleted_at is null and NEW.deleted_at is not null) then
      v_action := 'delete';
    else
      v_action := 'update';
    end if;
  else
    v_action := 'delete'; v_record_id := OLD.id;
    v_old := to_jsonb(OLD); v_new := null;
  end if;
  insert into public.audit_logs(table_name, record_id, action, actor, actor_email, detail)
  values (TG_TABLE_NAME, v_record_id, v_action, v_actor, v_email,
          jsonb_build_object('old', v_old, 'new', v_new));
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end;
$$;
drop trigger if exists trg_audit_transactions on transactions;
create trigger trg_audit_transactions
  after insert or update or delete on transactions
  for each row execute function log_audit();

-- 設定
create table if not exists settings (
  key text primary key,
  value jsonb
);

-- ユーザーの役割（admin / staff）
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz default now()
);

-- 入居履歴（個人情報の保管先。🔒列は暗号化して格納する）
create table if not exists leases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete cascade,
  status text default '入居',
  tenant_name text, tenant_phone text, tenant_email text,
  emergency_contact text, tenant_employer text,
  guarantor_name text, guarantor_relation text, guarantor_address text, guarantor_phone text,
  guarantor_company text, guarantor_contract_no text, guarantor_period text,
  rent numeric default 0, kyoeki numeric default 0, deposit numeric default 0, key_money numeric default 0,
  move_in date, move_out date, move_out_reason text,
  forwarding_address text, deposit_settlement numeric, restoration_cost numeric,
  created_at timestamptz default now(),
  pii_purge_at date
);

-- =====================================================================
-- 物件概要書（売買資料版）のスペック列・付随テーブル
-- 手本＝「台帳_プランドール守口.xlsx」の7シート構成。
-- レントロールは units を正とするので、ここにテーブルは作らない。
-- =====================================================================
-- ---------------------------------------------------------------------
-- 1) properties に売買資料で必要になるスペック列を追加
--    ※ 竣工年月は既存の built、構造・規模は既存の structure を使う（新設しない）
-- ---------------------------------------------------------------------
alter table properties add column if not exists chiban text;              -- 地番（住居表示=address とは別）
alter table properties add column if not exists main_use text;            -- 主要用途（共同住宅+事務所 等）
alter table properties add column if not exists fire_zone text;           -- 防火指定（防火地域 等）
alter table properties add column if not exists height_district text;     -- 高度地区
alter table properties add column if not exists building_cert_no text;    -- 建築確認番号
alter table properties add column if not exists building_cert text;       -- 確認済証（有り/無し）
alter table properties add column if not exists inspection_cert text;     -- 検査済証（有り/無し）
alter table properties add column if not exists standard_floor_area numeric; -- 基準階面積（㎡）
alter table properties add column if not exists max_height numeric;       -- 最高高さ（m）
alter table properties add column if not exists parking_count int;         -- 駐車場台数
alter table properties add column if not exists basement text;            -- 地下室有無
alter table properties add column if not exists unit_count_label text;    -- 総戸数／区画数（例「18戸4事務所」）
alter table properties add column if not exists mgmt_company text;        -- 管理会社
alter table properties add column if not exists mgmt_contact text;        -- 担当者
alter table properties add column if not exists mgmt_phone text;          -- 担当者連絡先

-- ---------------------------------------------------------------------
-- 2) 公的書類・確認書類（Excel「公的書類詳細」シート）
--    category='公的書類' … 確認済証・検査済証・定期報告・図面・謄本 等の有無
--    category='特殊設備' … 避雷設備・非常用発電機 等の法定対象設備
-- ---------------------------------------------------------------------
create table if not exists property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  category text not null default '公的書類',
  name text not null,               -- 書類名／設備名
  status text,                      -- 有 / 無 / 確認中
  file_name text,                   -- 現物のファイル名（保管場所の手がかり）
  law text,                         -- 根拠法令（特殊設備で使う）
  requirement text,                 -- 義務内容・頻度（特殊設備で使う）
  note text,
  sort_order numeric,
  updated_at timestamptz default now()
);
create index if not exists property_documents_property_idx on property_documents(property_id, sort_order);
alter table property_documents enable row level security;
drop policy if exists "auth all property_documents" on property_documents;
create policy "auth all property_documents" on property_documents for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 3) 法定点検・維持管理スケジュール（Excel「法定点検・維持管理」シート）
--    売買時の遵法性開示に使う。judgement に指摘・要修繕を残せる。
-- ---------------------------------------------------------------------
create table if not exists property_inspections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  category text,                    -- 建築基準法定期調査 / 消防法定期点検 / 水道法・衛生管理 等
  item text not null,               -- 点検項目名
  law text,                         -- 根拠法令・条文
  frequency text,                   -- 頻度（1年以内・3年以内 等）
  target text,                      -- 対象 / 非対象 / 確認中
  last_date date,                   -- 前回実施日
  next_date date,                   -- 次回実施日
  judgement text,                   -- ○適合 / △指摘あり / ×要修繕
  vendor text,                      -- 実施業者
  note text,                        -- 備考・指摘事項
  sort_order numeric,
  updated_at timestamptz default now()
);
create index if not exists property_inspections_property_idx on property_inspections(property_id, sort_order);
alter table property_inspections enable row level security;
drop policy if exists "auth all property_inspections" on property_inspections;
create policy "auth all property_inspections" on property_inspections for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 4) 年間運営費内訳（Excel「運営費内訳」シート）
--    収支表(transactions)は「実際に払った額」、こちらは「買主に示す想定運営費」。
--    支払先・支払サイクル・法定義務の別は transactions に無いのでここで持つ。
-- ---------------------------------------------------------------------
create table if not exists property_opex (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  category text,                    -- 管理費 / 法定点検費 / 修繕費 / 光熱費（共用） / 通信費 / 保険・税 / その他
  name text not null,               -- 費目名称
  payee text,                       -- 支払先
  cycle text,                       -- 支払サイクル（月次 / 年次 / 年2回 / なし）
  monthly numeric,                  -- 月額（円）
  annual numeric,                   -- 年額（円）
  mandatory text,                   -- 義務 / 任意 / 義務（◯◯有）
  note text,
  sort_order numeric,
  updated_at timestamptz default now()
);
create index if not exists property_opex_property_idx on property_opex(property_id, sort_order);
alter table property_opex enable row level security;
drop policy if exists "auth all property_opex" on property_opex;
create policy "auth all property_opex" on property_opex for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 5) 修繕履歴（Excel「修繕費(専有部)」「修繕費(共用部)」シート）
--    transactions の修繕費は金額だけなので、箇所・内容・業者はここで持つ。
--    major=true が大規模改修（原本では赤文字）。売買資料の売り材料になる。
-- ---------------------------------------------------------------------
create table if not exists property_repairs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  scope text not null default '共用部',  -- 専有部 / 共用部
  repaired_on date,
  kind text,                        -- 分類（居室 / 設備 / 防水 / 全体 / 一部階）
  place text,                       -- 修繕箇所
  content text,                     -- 修繕内容
  vendor text,                      -- 会社名
  cost numeric,
  major boolean not null default false, -- 大規模改修
  note text,
  sort_order numeric,
  updated_at timestamptz default now()
);
create index if not exists property_repairs_property_idx on property_repairs(property_id, scope, repaired_on);
alter table property_repairs enable row level security;
drop policy if exists "auth all property_repairs" on property_repairs;
create policy "auth all property_repairs" on property_repairs for all to authenticated using (true) with check (true);

-- 役割判定ヘルパー
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- インデックス
create index if not exists idx_units_property on units(property_id);
create index if not exists idx_tx_property on transactions(property_id);
create index if not exists idx_tx_date on transactions(date);
create index if not exists idx_leases_unit on leases(unit_id);

-- RLS 有効化
alter table properties   enable row level security;
alter table units        enable row level security;
alter table transactions enable row level security;
alter table settings     enable row level security;
alter table profiles     enable row level security;
alter table leases       enable row level security;

-- ポリシー：物件・部屋・入出金・設定はログイン済みなら可（個人情報は含まない）
-- ※ create policy は IF NOT EXISTS が使えないため、再実行に備え drop policy if exists を前置する。
drop policy if exists "auth all properties"   on properties;
drop policy if exists "auth all units"         on units;
drop policy if exists "auth all transactions"  on transactions;
drop policy if exists "auth all settings"      on settings;
drop policy if exists "profiles self read"     on profiles;
drop policy if exists "profiles admin write"   on profiles;
drop policy if exists "leases admin only"      on leases;

create policy "auth all properties"   on properties   for all to authenticated using (true) with check (true);
create policy "auth all units"         on units         for all to authenticated using (true) with check (true);
create policy "auth all transactions"  on transactions  for all to authenticated using (true) with check (true);
create policy "auth all settings"      on settings      for all to authenticated using (true) with check (true);

-- profiles：本人は自分の行を参照、adminは全件
create policy "profiles self read"  on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy "profiles admin write" on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- leases（個人情報）：管理者(admin)のみ全操作可。一般スタッフはアクセス不可
create policy "leases admin only" on leases for all to authenticated using (is_admin()) with check (is_admin());
-- ※ 一般スタッフが「現在入居中か」「契約満了」など非個人情報だけを見たい場合は、
--    号室・status・契約満了のみを返すビュー（個人情報を除外）を別途作成して参照させる。

-- 保持年数の初期値（settings）
insert into settings (key, value) values
  ('pii_retention_years', '2'::jsonb),
  ('accounting_retention_years', '7'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
-- M1 追加：プロフィール自動作成・PII暗号化・leases用RPC
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) サインアップ時に profiles 行を自動作成（既定は staff）
--     ※ 最初の管理者は手動で昇格する：
--        update profiles set role='admin' where email='owner@example.com';
-- ---------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- (2) 機微項目（leasesの🔒列）の暗号化／復号（SOW 7.3）
--     ・鍵は Supabase Vault に保管し、クライアント（anon鍵）には一切出さない。
--     ・復号は is_admin() のみ。スタッフは RLS でそもそも leases に到達不可。
--
--     事前準備（Supabase SQL Editor / Vault で一度だけ実行）：
--       select vault.create_secret('<ランダムな長い文字列>', 'rentbook_pii_key');
-- ---------------------------------------------------------------------
create or replace function pii_key() returns text
language sql security definer stable as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'rentbook_pii_key' limit 1;
$$;

create or replace function pii_encrypt(plaintext text) returns text
language plpgsql security definer as $$
declare k text;
begin
  if plaintext is null or plaintext = '' then return null; end if;
  k := pii_key();
  if k is null then raise exception 'rentbook_pii_key (Vault secret) が未設定です'; end if;
  return encode(pgp_sym_encrypt(plaintext, k), 'base64');
end;
$$;

create or replace function pii_decrypt(ciphertext text) returns text
language plpgsql security definer as $$
declare k text;
begin
  if ciphertext is null then return null; end if;
  if not is_admin() then return null; end if;  -- 復号は admin のみ
  k := pii_key();
  if k is null then return null; end if;
  return pgp_sym_decrypt(decode(ciphertext, 'base64'), k);
exception when others then
  return null;  -- 平文混在など復号不能時は黙って NULL
end;
$$;

-- ---------------------------------------------------------------------
-- (3) leases 用 RPC（暗号化は必ずサーバ側で行う。M3 の入退去UIから呼ぶ）
-- ---------------------------------------------------------------------

-- 号室の入居履歴を「復号済み」で返す（admin のみ。非adminは空）
create or replace function leases_for_unit(p_unit_id uuid)
returns setof leases
language sql security definer stable as $$
  select
    l.id, l.unit_id, l.status,
    pii_decrypt(l.tenant_name), pii_decrypt(l.tenant_phone), pii_decrypt(l.tenant_email),
    pii_decrypt(l.emergency_contact), pii_decrypt(l.tenant_employer),
    pii_decrypt(l.guarantor_name), pii_decrypt(l.guarantor_relation),
    pii_decrypt(l.guarantor_address), pii_decrypt(l.guarantor_phone),
    l.guarantor_company, l.guarantor_contract_no, l.guarantor_period,
    l.rent, l.kyoeki, l.deposit, l.key_money,
    l.move_in, l.move_out, l.move_out_reason,
    pii_decrypt(l.forwarding_address), l.deposit_settlement, l.restoration_cost,
    l.created_at, l.pii_purge_at
  from leases l
  where l.unit_id = p_unit_id and is_admin();
$$;

-- 入居履歴を作成（🔒列はサーバ側で暗号化。admin のみ）
create or replace function lease_create(p jsonb)
returns uuid
language plpgsql security definer as $$
declare new_id uuid;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  insert into leases (
    unit_id, status,
    tenant_name, tenant_phone, tenant_email, emergency_contact, tenant_employer,
    guarantor_name, guarantor_relation, guarantor_address, guarantor_phone,
    guarantor_company, guarantor_contract_no, guarantor_period,
    rent, kyoeki, deposit, key_money,
    move_in, move_out, move_out_reason,
    forwarding_address, deposit_settlement, restoration_cost, pii_purge_at
  ) values (
    (p->>'unit_id')::uuid, coalesce(p->>'status', '入居'),
    pii_encrypt(p->>'tenant_name'), pii_encrypt(p->>'tenant_phone'), pii_encrypt(p->>'tenant_email'),
    pii_encrypt(p->>'emergency_contact'), pii_encrypt(p->>'tenant_employer'),
    pii_encrypt(p->>'guarantor_name'), pii_encrypt(p->>'guarantor_relation'),
    pii_encrypt(p->>'guarantor_address'), pii_encrypt(p->>'guarantor_phone'),
    p->>'guarantor_company', p->>'guarantor_contract_no', p->>'guarantor_period',
    nullif(p->>'rent', '')::numeric, nullif(p->>'kyoeki', '')::numeric,
    nullif(p->>'deposit', '')::numeric, nullif(p->?'key_money', '')::numeric,
    nullif(p->>'move_in', '')::date, nullif(p->>'move_out', '')::date, p->>'move_out_reason',
    pii_encrypt(p->>'forwarding_address'),
    nullif(p->>'deposit_settlement', '')::numeric, nullif(p->>'restoration_cost', '')::numeric,
    nullif(p->>'pii_purge_at', '')::date
  ) returning id into new_id;
  return new_id;
end;
$$;

-- 退去処理（move_out 設定・転居先は暗号化・pii_purge_at を保持年数から自動計算。admin のみ）
create or replace function lease_end(p jsonb)
returns void
language plpgsql security definer as $$
declare yrs int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select coalesce((value::text)::int, 2) into yrs from settings where key = 'pii_retention_years';
  if yrs is null then yrs := 2; end if;
  update leases set
    status = '退去',
    move_out = nullif(p->>'move_out', '')::date,
    move_out_reason = p->>'move_out_reason',
    forwarding_address = pii_encrypt(p->>'forwarding_address'),
    deposit_settlement = nullif(p->>'deposit_settlement', '')::numeric,
    restoration_cost = nullif(p->>'restoration_cost', '')::numeric,
    pii_purge_at = (coalesce(nullif(p->>'move_out', '')::date, current_date) + make_interval(years => yrs))::date
  where id = (p->>'id')::uuid;
end;
$$;

-- =====================================================================
-- M4 追加：保持期間ポリシーの自動削除（SOW 7.4）
--   個人情報（leasesの🔒列）＝退去後 pii_retention_years（既定2年）で匿名化（NULL化）。
--   会計データ（transactions 等）は accounting_retention_years（既定7年）まで残す。
-- =====================================================================

-- 期限到来分の🔒列を NULL 化（匿名化）。戻り値＝処理件数。
create or replace function purge_expired_pii() returns integer
language plpgsql security definer as $$
declare cnt int;
begin
  update leases set
    tenant_name = null, tenant_phone = null, tenant_email = null,
    emergency_contact = null, tenant_employer = null,
    guarantor_name = null, guarantor_relation = null, guarantor_address = null, guarantor_phone = null,
    forwarding_address = null
  where pii_purge_at is not null
    and pii_purge_at <= current_date
    and coalesce(
      tenant_name, tenant_phone, tenant_email, emergency_contact, tenant_employer,
      guarantor_name, guarantor_relation, guarantor_address, guarantor_phone, forwarding_address
    ) is not null;
  get diagnostics cnt = row_count;
  return cnt;
end;
$$;

-- 日次ジョブ（pg_cron）。Supabase では Database > Extensions で pg_cron を有効化してから実行する。
-- 既に同名ジョブがあれば一度 unschedule してから登録する。
--   create extension if not exists pg_cron;
--   select cron.unschedule('rentbook-purge-pii')
--     where exists (select 1 from cron.job where jobname = 'rentbook-purge-pii');
--   select cron.schedule('rentbook-purge-pii', '0 3 * * *', $$ select purge_expired_pii(); $$);

-- =====================================================================
-- 入退去シート（move_events）
-- 「いつ入居／退去したか」と「その月の請求をどうするか」だけを持つ運用テーブル。
-- 個人情報（連絡先・保証人など）は暗号化された leases 側に置くので、ここには入れない。
--
-- 退去は予告を受けた時点で1行作る（scheduled_date＝予告書に書かれた退去予定日）。
-- 退去月の家賃は満額もらう運用なので final_ym は既定で退去月そのもの。
-- 入居は入居日の月が日割りになるので、prorated_amount に契約書どおりの額を手で入れる
-- （実日数からの目安は画面に出すが、仲介会社ごとに計算が違うので採用しない）。
create table if not exists move_events (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete cascade,
  kind text not null check (kind in ('入居','退去')),
  -- 退去：予告を受けた日と、予告書に書かれた退去予定日
  notice_date date,
  scheduled_date date,
  -- 実際の入居日／退去日
  actual_date date,
  -- 入居：日割り家賃と、それを計上する年月／満額請求を始める年月（'YYYY-MM'）
  prorated_amount numeric,
  prorated_ym text,
  first_full_ym text,
  -- 退去：最終請求月（'YYYY-MM'）。退去月は満額なので既定は退去月
  final_ym text,
  -- 記録用の契約者名と読み。units 側は退去時にクリアするので、ここに控えを残す
  tenant text,
  tenant_kana text,
  memo text,
  -- 入居は予約として登録し、入居日が来たら部屋へ反映する。
  -- unit_patch＝反映待ちの契約内容（units に入れる値）、applied_at＝反映済みの目印。
  unit_patch jsonb,
  applied_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists move_events_unit_idx on move_events(unit_id, kind, actual_date);
alter table move_events enable row level security;
drop policy if exists "auth all move_events" on move_events;
create policy "auth all move_events" on move_events for all to authenticated using (true) with check (true);
