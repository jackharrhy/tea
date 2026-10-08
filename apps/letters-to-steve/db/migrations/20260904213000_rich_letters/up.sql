alter table letters add column body_json text;
alter table letters add column font_key text not null default 'handwritten'
  check (font_key in ('handwritten', 'book', 'plain'));

alter table issues add column response_json text;

alter table issue_letters add column public_body_json text;
alter table issue_letters add column font_key text not null default 'handwritten'
  check (font_key in ('handwritten', 'book', 'plain'));

create table attachments (
  id text primary key,
  draft_token text not null,
  letter_id integer references letters (id) on delete cascade,
  storage_key text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  is_public integer not null default 0 check (is_public in (0, 1)),
  created_at integer not null
);

create index attachments_letter_id_idx on attachments (letter_id);
create index attachments_draft_token_idx on attachments (draft_token);
create index attachments_created_at_idx on attachments (created_at);
