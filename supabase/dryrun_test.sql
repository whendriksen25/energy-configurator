\set ON_ERROR_STOP 0
set role service_role;
select public.energy_save_configuration(jsonb_build_object(
  'tenant_id','99cc77f3-e2dc-4406-8fbd-3676508aa006','ip_hash','abc','model_version','2026.10-5','locale','nl',
  'site_label','Office 250 MWh','segment','office','capex_eur',245000.4,'npv_eur',119306,'consent_version','2026-10-05',
  'checked_on_server',true,'inputs','{"site_type":"office"}','result','{"npv_eur":119306}',
  'contact', jsonb_build_object('first_name','Test','last_name','Persoon','email','Test@Example.nl','company','TEST Kantoor BV','phone',''),
  'quote_lines', '[{"part":"solar","description":"Solar 300 kWp","quantity":300,"unit_price":650,"tax_rate":21},
                   {"part":"battery","description":"Battery 30 kWh","quantity":30,"unit_price":1000.0133,"tax_rate":21},
                   {"part":"ems","description":"EMS","quantity":1,"unit_price":12000,"tax_rate":21},
                   {"part":"engineering","description":"Eng","quantity":1,"unit_price":8000,"tax_rate":21}]'::jsonb)) as first_save;
select public.energy_save_configuration(jsonb_build_object(
  'tenant_id','99cc77f3-e2dc-4406-8fbd-3676508aa006','ip_hash','abc','model_version','2026.10-5',
  'site_label','Office again','capex_eur',1000,'npv_eur',1,'consent_version','2026-10-05','inputs','{}','result','{}',
  'contact', jsonb_build_object('first_name','Test','last_name','Persoon','email','test@example.nl','company','test kantoor bv'),
  'quote_lines','[]'::jsonb)) as second_save;
select count(*) contacts, (select count(*) from companies) companies, (select count(*) from deals) deals, (select count(*) from quotes) quotes, (select count(*) from energy_configurations) confs from contacts;
select quote_number, subtotal, tax_amount, total, (select sum(total) from quote_items qi where qi.quote_id=q.id) items from quotes q;
select count(*) filter (where product_id is not null) linked, count(*) from quote_items;
-- rate limit: 3 more saves from same ip_hash -> 5th allowed, 6th refused
select public.energy_save_configuration(jsonb_build_object('tenant_id','99cc77f3-e2dc-4406-8fbd-3676508aa006','ip_hash','abc','model_version','2026.10-5','capex_eur',1,'npv_eur',1,'consent_version','x','inputs','{}','result','{}','contact',jsonb_build_object('first_name','A','email','a'||g||'@x.nl'))) is not null from generate_series(1,3) g;
select public.energy_save_configuration(jsonb_build_object('tenant_id','99cc77f3-e2dc-4406-8fbd-3676508aa006','ip_hash','abc','model_version','2026.10-5','capex_eur',1,'npv_eur',1,'consent_version','x','inputs','{}','result','{}','contact',jsonb_build_object('first_name','A','email','z@x.nl')));
-- tenant not enabled
select public.energy_save_configuration(jsonb_build_object('tenant_id','11111111-1111-1111-1111-111111111111','ip_hash','q','model_version','2026.10-5','capex_eur',1,'npv_eur',1,'consent_version','x','inputs','{}','result','{}','contact',jsonb_build_object('first_name','A','email','q@x.nl')));
reset role;
-- anon
set role anon;
select 'anon reads configurations', count(*) from energy_configurations;
select 'anon reads settings', count(*) from energy_tenant_settings;
select 'anon reads contacts', count(*) from contacts;
select 'anon reads reference', count(*) from energy_reference;
select 'anon execute', public.energy_save_configuration('{}'::jsonb);
insert into energy_reference values ('x', now(), '{}');
reset role;
-- authenticated, other tenant
set role authenticated; set request.jwt.uid = '22222222-2222-2222-2222-222222222222';
select 'other tenant sees configs', count(*) from energy_configurations;
select 'other tenant execute', public.energy_save_configuration('{}'::jsonb);
-- authenticated, Demo owner
set request.jwt.uid = '37c09cab-427b-4d8d-8d94-59dbea73d21c';
select 'demo owner sees configs', count(*) from energy_configurations;
insert into energy_configurations (tenant_id, model_version, inputs, result, consent_at, consent_version) values ('99cc77f3-e2dc-4406-8fbd-3676508aa006','2026.10-5','{}','{}',now(),'x');
reset role;
