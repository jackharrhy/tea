drop index if exists letters_visibility_created_at_idx;

alter table letters rename to legacy_letters;

create table letters (
  id integer primary key autoincrement,
  author text not null,
  email text,
  body text not null,
  can_publish integer not null check (can_publish in (0, 1)),
  state text not null check (state in ('inbox', 'draft', 'published', 'archived')),
  created_at integer not null,
  private_replied_at integer
);

insert into letters (
  id,
  author,
  email,
  body,
  can_publish,
  state,
  created_at,
  private_replied_at
)
select
  id,
  author,
  email,
  body,
  case when visibility = 'public' then 1 else 0 end,
  case
    when visibility = 'public' and public_reply is not null then 'published'
    else 'inbox'
  end,
  created_at,
  null
from legacy_letters;

create table issues (
  id integer primary key autoincrement,
  response text not null,
  state text not null check (state in ('draft', 'published')),
  created_at integer not null,
  updated_at integer not null,
  published_at integer
);

insert into issues (id, response, state, created_at, updated_at, published_at)
select
  id,
  public_reply,
  'published',
  created_at,
  coalesce(replied_at, created_at),
  coalesce(replied_at, created_at)
from legacy_letters
where visibility = 'public' and public_reply is not null;

create table issue_letters (
  id integer primary key autoincrement,
  issue_id integer not null references issues (id) on delete cascade,
  letter_id integer not null unique references letters (id),
  position integer not null,
  public_author text not null,
  public_body text not null,
  unique (issue_id, position)
);

insert into issue_letters (
  issue_id,
  letter_id,
  position,
  public_author,
  public_body
)
select id, id, 0, author, body
from legacy_letters
where visibility = 'public' and public_reply is not null;

drop table legacy_letters;

create index letters_state_created_at_idx
  on letters (state, created_at desc);

create index issues_state_published_at_idx
  on issues (state, published_at desc);

create index issue_letters_issue_position_idx
  on issue_letters (issue_id, position);
