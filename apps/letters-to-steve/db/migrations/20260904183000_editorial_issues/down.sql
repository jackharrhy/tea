drop index if exists issue_letters_issue_position_idx;
drop index if exists issues_state_published_at_idx;
drop index if exists letters_state_created_at_idx;

alter table letters rename to editorial_letters;

create table letters (
  id integer primary key autoincrement,
  author text not null,
  email text,
  body text not null,
  design text not null check (design in ('airmail', 'graph', 'pressed', 'night')),
  visibility text not null check (visibility in ('public', 'private')),
  public_reply text,
  created_at integer not null,
  replied_at integer
);

insert into letters (
  id,
  author,
  email,
  body,
  design,
  visibility,
  public_reply,
  created_at,
  replied_at
)
select
  letter.id,
  letter.author,
  letter.email,
  letter.body,
  'airmail',
  case when letter.can_publish = 1 then 'public' else 'private' end,
  issue.response,
  letter.created_at,
  issue.published_at
from editorial_letters as letter
left join issue_letters as issue_letter on issue_letter.letter_id = letter.id
left join issues as issue
  on issue.id = issue_letter.issue_id and issue.state = 'published';

drop table issue_letters;
drop table issues;
drop table editorial_letters;

create index letters_visibility_created_at_idx
  on letters (visibility, created_at desc);
