create table site_settings (
  id integer primary key check (id = 1),
  is_enabled integer not null default 0 check (is_enabled in (0, 1)),
  updated_at integer not null
);

insert into site_settings (id, is_enabled, updated_at)
values (1, 0, unixepoch('subsec') * 1000);
