drop table if exists attachments;

alter table issue_letters drop column font_key;
alter table issue_letters drop column public_body_json;
alter table issues drop column response_json;
alter table letters drop column font_key;
alter table letters drop column body_json;
