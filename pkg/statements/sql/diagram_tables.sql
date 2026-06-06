SELECT
  c.relname AS name,
  c.reltuples::bigint AS est_rows,
  pg_total_relation_size(c.oid) AS size_bytes
FROM
  pg_class c
JOIN
  pg_namespace n ON n.oid = c.relnamespace
WHERE
  n.nspname = $1
  AND c.relkind IN ('r', 'p')
