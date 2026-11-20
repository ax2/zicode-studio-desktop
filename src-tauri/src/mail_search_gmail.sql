SELECT a.id AS account, a.address, a.provider, json_extract(hit.value,'$.id') AS id, NULL AS epoch,
       json_extract(hit.value,'$.subject') AS subject, json_extract(hit.value,'$.from') AS sender
FROM accounts a JOIN gmail_cache c ON c.workspace=a.scope AND c.account=a.id
JOIN json_each(CASE c.kind WHEN 'page' THEN json_extract(c.value,'$.items')
                           WHEN 'body' THEN json_array(json(c.value)) ELSE '[]' END) hit
WHERE a.scope=?1 AND a.provider='gmail' AND (?2 IS NULL OR a.id=?2)
  AND (instr(lower(json_extract(hit.value,'$.subject')),lower(?3))>0
    OR instr(lower(json_extract(hit.value,'$.from')),lower(?3))>0
    OR instr(lower(json_extract(hit.value,'$.snippet')),lower(?3))>0
    OR instr(lower(json_extract(hit.value,'$.plainText')),lower(?3))>0)
