create table steve_sessions (
  id integer primary key autoincrement,
  token_hash text not null unique,
  subject text not null,
  expires_at integer not null
);
