-- =============================================================================
-- StreakUp — Phase 5 (auto-scaling customer PIN; run after phase4.sql)
-- =============================================================================
-- Server-generated PINs only (BEFORE INSERT trigger). Never trust client PIN.
-- 4-digit space until a cafe reaches 8000 customers; then new PINs use 5 digits.

begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public._customer_pin_digit_width(p_cafe_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select count(*)::bigint from public.customers c where c.cafe_id = p_cafe_id) >= 8000
    then 5
    else 4
  end;
$$;

create or replace function public._random_pin_digits_secure(p_digits int)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  b bytea;
  n bigint;
begin
  if p_digits = 4 then
    b := gen_random_bytes(2);
    n := (get_byte(b, 0)::bigint * 256 + get_byte(b, 1)::bigint) % 9000 + 1000;
    return lpad(n::text, 4, '0');
  elsif p_digits = 5 then
    b := gen_random_bytes(4);
    n := (
      (get_byte(b, 0)::bigint << 24)
      | (get_byte(b, 1)::bigint << 16)
      | (get_byte(b, 2)::bigint << 8)
      | (get_byte(b, 3)::bigint)
    );
    if n < 0 then
      n := -n;
    end if;
    n := (n % 90000) + 10000;
    return lpad(n::text, 5, '0');
  end if;
  raise exception 'invalid_pin_width';
end;
$$;

create or replace function public.allocate_customer_pin(p_cafe_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_digits int;
  v_pin text;
  v_try int := 0;
begin
  v_digits := public._customer_pin_digit_width(p_cafe_id);

  loop
    v_try := v_try + 1;
    if v_try > 64 then
      raise exception 'pin_allocation_exhausted';
    end if;

    v_pin := public._random_pin_digits_secure(v_digits);

    exit when not exists (
      select 1
      from public.customers c
      where c.cafe_id = p_cafe_id
        and c.pin_code = v_pin
    );
  end loop;

  return v_pin;
end;
$$;

create or replace function public.customers_assign_pin_bi()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.pin_code := public.allocate_customer_pin(new.cafe_id);
  return new;
end;
$$;

drop trigger if exists customers_assign_pin_bi on public.customers;
create trigger customers_assign_pin_bi
before insert on public.customers
for each row
execute function public.customers_assign_pin_bi();

revoke all on function public._customer_pin_digit_width(uuid) from public;
revoke all on function public._random_pin_digits_secure(int) from public;
revoke all on function public.allocate_customer_pin(uuid) from public;

commit;
