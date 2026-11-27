SELECT account,address,provider,id,epoch,subject,sender,NULL AS folder FROM (
SELECT a.id AS account, a.address, a.provider, json_extract(hit.value,'$.id') AS id, NULL AS epoch,
       json_extract(hit.value,'$.subject') AS subject, json_extract(hit.value,'$.from') AS sender,
       row_number() OVER (PARTITION BY a.id,json_extract(hit.value,'$.id')
                          ORDER BY (c.kind='body') DESC,c.rowid DESC) AS choice
FROM accounts a JOIN gmail_cache c ON c.workspace=a.scope AND c.account=a.id
JOIN json_each(CASE c.kind WHEN 'page' THEN json_extract(c.value,'$.items')
                           WHEN 'body' THEN json_array(json(c.value)) ELSE '[]' END) hit
WHERE a.scope=?1 AND a.provider='gmail' AND (?2 IS NULL OR a.id=?2)
  AND (?5 IS NULL OR json_extract(hit.value,'$.id') IN (
    SELECT json_extract(member.value,'$.id')
    FROM gmail_cache page JOIN json_each(page.value,'$.items') member
    WHERE page.workspace=?1 AND page.account=?2 AND page.kind='page'
      AND CASE WHEN ?5='INBOX' THEN page.cache_key NOT GLOB 'label:*'
               ELSE instr(page.cache_key,'label:' || ?5 || ':')=1 END
  ))
  AND (instr(mail_fold_case(json_extract(hit.value,'$.subject')),?3)>0
    OR instr(mail_fold_case(json_extract(hit.value,'$.from')),?3)>0
    OR instr(mail_fold_case(json_extract(hit.value,'$.snippet')),?3)>0
    OR instr(mail_fold_case(json_extract(hit.value,'$.plainText')),?3)>0)
) WHERE choice=1
