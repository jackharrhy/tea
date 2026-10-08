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

create index letters_visibility_created_at_idx
  on letters (visibility, created_at desc);
