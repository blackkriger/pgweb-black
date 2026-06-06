SELECT
  c.relname AS table_name,
  a.attname AS name,
  format_type(a.atttypid, a.atttypmod) AS type,
  COALESCE(bool_or(con.contype = 'p'), false) AS is_primary,
  COALESCE(bool_or(con.contype = 'f'), false) AS is_foreign
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
WHERE
  n.nspname = $1
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
GROUP BY
  c.relname, a.attname, a.atttypid, a.atttypmod, a.attnum
ORDER BY
  c.relname, a.attnum
