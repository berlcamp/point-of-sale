-- Enforce one product per barcode within a company so a scan at the
-- register always resolves to a single product.

-- Existing data may already contain duplicates; keep the oldest product's
-- barcode and clear it on the rest so the unique index can build.
with dupes as (
  select id,
         row_number() over (
           partition by company_id, barcode
           order by created_at, id
         ) as rn
  from point_of_sale.products
  where barcode is not null
)
update point_of_sale.products p
set barcode = null
from dupes d
where p.id = d.id
  and d.rn > 1;

drop index if exists point_of_sale.idx_products_barcode;

create unique index if not exists uq_products_company_barcode
  on point_of_sale.products (company_id, barcode)
  where barcode is not null;
