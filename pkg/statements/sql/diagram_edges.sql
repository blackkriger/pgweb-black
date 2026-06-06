SELECT
  con.conname AS name,
  src.relname AS source_table,
  sa.attname AS source_column,
  tgt.relname AS target_table,
  ta.attname AS target_column
FROM
  pg_constraint con
JOIN
  pg_namespace n ON n.oid = con.connamespace
JOIN
  pg_class src ON src.oid = con.conrelid
JOIN
  pg_class tgt ON tgt.oid = con.confrelid
JOIN LATERAL
  unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(src_attnum, tgt_attnum, ord) ON true
JOIN
  pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = k.src_attnum
JOIN
  pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = k.tgt_attnum
WHERE
  con.contype = 'f'
  AND n.nspname = $1
ORDER BY
  src.relname, con.conname, k.ord
