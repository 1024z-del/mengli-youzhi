-- ============================================================
-- 梦里有zhi · 社交版 数据库初始化脚本
-- 使用方法：Supabase 控制台 → SQL Editor → 新建查询 → 粘贴全部 → Run
-- ============================================================

-- ========== 第一部分：创建所有表 ==========

-- 1. 用户资料
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

-- 2. 邀请码
create table if not exists public.invite_codes (
  code text primary key,
  created_by uuid references auth.users(id) on delete cascade,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz default now()
);
alter table public.invite_codes enable row level security;

-- 3. 好友关系
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (user_a, user_b)
);
alter table public.friendships enable row level security;

-- 4. 日记
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  text text,
  media_path text,
  media_type text,
  stickers text[] default '{}',
  visibility text not null default 'private',
  created_at timestamptz default now()
);
alter table public.posts enable row level security;

-- 5. 指定好友可见（在 can_view_post 之前创建）
create table if not exists public.post_acl (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (post_id, user_id)
);
alter table public.post_acl enable row level security;

-- ========== 第二部分：创建所有函数 ==========

-- 用户名是否已被占用
create or replace function public.username_taken(p_username text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where lower(username) = lower(p_username));
$$;
grant execute on function public.username_taken(text) to anon, authenticated;

-- 邀请码是否可用
create or replace function public.check_invite(p_code text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.invite_codes where upper(code) = upper(p_code) and used_by is null);
$$;
grant execute on function public.check_invite(text) to anon, authenticated;

-- 兑换邀请码
create or replace function public.redeem_invite(p_code text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.invite_codes;
begin
  select * into v_row from public.invite_codes where upper(code) = upper(p_code) for update;
  if not found then return false; end if;
  if v_row.used_by is not null then return false; end if;
  update public.invite_codes set used_by = auth.uid(), used_at = now() where code = v_row.code;
  return true;
end;
$$;
grant execute on function public.redeem_invite(text) to authenticated;

-- 是否是好友
create or replace function public.are_friends(me uuid, other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.friendships f
    where (f.user_a = me and f.user_b = other)
       or (f.user_a = other and f.user_b = me)
  );
$$;

-- 能不能看这条日记（security definer，避免策略递归）
create or replace function public.can_view_post(p_post uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.posts p
    where p.id = p_post and (
      p.author_id = p_user
      or (p.visibility = 'friends' and public.are_friends(p_user, p.author_id))
      or (p.visibility = 'selected' and exists (
        select 1 from public.post_acl a where a.post_id = p.id and a.user_id = p_user
      ))
    )
  );
$$;

-- 是不是日记作者
create or replace function public.is_post_author(p_post uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.posts where id = p_post and author_id = p_user);
$$;

-- ========== 第三部分：创建所有权限策略 ==========

-- profiles
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid());

-- invite_codes
drop policy if exists "invite_select_own" on public.invite_codes;
create policy "invite_select_own" on public.invite_codes
  for select to authenticated using (created_by = auth.uid() or used_by = auth.uid());

drop policy if exists "invite_insert_own" on public.invite_codes;
create policy "invite_insert_own" on public.invite_codes
  for insert to authenticated with check (created_by = auth.uid());

-- friendships
drop policy if exists "friends_select_own" on public.friendships;
create policy "friends_select_own" on public.friendships
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists "friends_insert_self" on public.friendships;
create policy "friends_insert_self" on public.friendships
  for insert to authenticated with check (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists "friends_delete_own" on public.friendships;
create policy "friends_delete_own" on public.friendships
  for delete to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- posts
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts
  for select to authenticated using (public.can_view_post(posts.id, auth.uid()));

drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts
  for delete to authenticated using (author_id = auth.uid());

-- post_acl
drop policy if exists "acl_select" on public.post_acl;
create policy "acl_select" on public.post_acl
  for select to authenticated using (
    user_id = auth.uid() or public.is_post_author(post_id, auth.uid())
  );

drop policy if exists "acl_insert_own_post" on public.post_acl;
create policy "acl_insert_own_post" on public.post_acl
  for insert to authenticated with check (public.is_post_author(post_id, auth.uid()));

-- ========== 第四部分：媒体存储桶 ==========

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media_read_auth" on storage.objects;
create policy "media_read_auth" on storage.objects
  for select to authenticated using (bucket_id = 'media');

drop policy if exists "media_insert_own" on storage.objects;
create policy "media_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_delete_own" on storage.objects;
create policy "media_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========== 第五部分：启动邀请码 ==========

alter table public.invite_codes alter column created_by drop not null;
insert into public.invite_codes (code) values ('MLYZ01')
on conflict (code) do nothing;

-- ========== 第六部分：完成 ==========

-- （邮箱验证通过注册后点邮件链接完成，更安全）

select '梦里有zhi 数据库初始化完成 ✅' as result;
