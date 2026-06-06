SELECT
  c.relname AS table_name,
  a.attname AS name,
  format_type(a.atttypid, a.atttypmod) AS type,
  COALESCE(bool_or(con.contype = 'p'), false) AS is_primary,
  COALESCE(bool_or(con.contype = 'f'), false) AS is_foreign,
  COALESCE(bool_or(ix.indexrelid IS NOT NULL), false) AS is_indexed,
  COALESCE(bool_or(ix.indisunique), false) AS is_unique,
  a.attnotnull AS is_not_null,
  (a.attidentity <> '') AS is_identity,
  (a.attgenerated <> '') AS is_generated,
  COALESCE(max(pg_get_expr(ad.adbin, ad.adrelid)), '') AS default_expr
FROM
  pg_attribute a
JOIN
  pg_class c ON c.oid = a.attrelid
JOIN
  pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN
  pg_constraint con ON con.conrelid = c.oid
                   AND a.attnum = ANY(con.conkey)
                   AND con.contype IN ('p', 'f')
LEFT JOIN
  pg_index ix ON ix.indrelid = c.oid
             AND a.attnum = ANY(ix.indkey)
LEFT JOIN
  pg_attrdef ad ON ad.adrelid = c.oid
               AND ad.adnum = a.attnum
WHERE
  n.nspname = $1
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
GROUP BY
  c.relname, a.attname, a.atttypid, a.atttypmod, a.attnum,
  a.attnotnull, a.attidentity, a.attgenerated
ORDER BY
  c.relname, a.attnum
