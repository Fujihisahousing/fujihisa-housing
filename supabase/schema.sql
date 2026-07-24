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
