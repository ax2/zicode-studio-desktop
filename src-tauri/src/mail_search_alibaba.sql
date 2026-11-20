SELECT a.id AS account, a.address, a.provider, CAST(m.uid AS TEXT) AS id, m.epoch,
       json_extract(m.meta,'$.subject') AS subject, json_extract(m.meta,'$.sender') AS sender
FROM accounts a JOIN alibaba_inbox m ON m.scope=a.scope AND m.account=a.id
JOIN alibaba_epoch e ON e.scope=m.scope AND e.account=m.account AND e.epoch=m.epoch
WHERE a.scope=?1 AND a.provider='alibaba' AND (?2 IS NULL OR a.id=?2)
  AND (instr(lower(json_extract(m.meta,'$.subject')),lower(?3))>0
    OR instr(lower(json_extract(m.meta,'$.sender')),lower(?3))>0
    OR instr(lower(m.body),lower(?3))>0)
