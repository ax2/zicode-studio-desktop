SELECT a.id AS account, a.address, a.provider, CAST(m.uid AS TEXT) AS id, m.epoch,
       json_extract(m.meta,'$.subject') AS subject, json_extract(m.meta,'$.sender') AS sender, m.folder
FROM accounts a JOIN alibaba_inbox m ON m.scope=a.scope AND m.account=a.id
JOIN alibaba_epoch e ON e.scope=m.scope AND e.account=m.account AND e.folder=m.folder AND e.epoch=m.epoch
WHERE (?5 IS NULL OR m.folder=?5) AND a.scope=?1 AND a.provider='alibaba' AND (?2 IS NULL OR a.id=?2)
  AND (instr(mail_fold_case(json_extract(m.meta,'$.subject')),?3)>0
    OR instr(mail_fold_case(json_extract(m.meta,'$.sender')),?3)>0
    OR instr(mail_fold_case(json_extract(m.meta,'$.senderName')),?3)>0
    OR instr(mail_fold_case(m.body),?3)>0)
