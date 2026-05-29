SELECT
  a.attname AS name,
  format_type(a.atttypid, a.atttypmod) AS type,
  (pk.conkey IS NOT NULL) AS is_primary
FROM
  pg_attribute a
JOIN
  pg_class c ON c.oid = a.attrelid
JOIN
  pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN
  pg_constraint pk ON pk.conrelid = c.oid
                  AND pk.contype = 'p'
                  AND a.attnum = ANY(pk.conkey)
WHERE
  n.nspname = $1
  AND c.relname = $2
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY
  a.attnum
