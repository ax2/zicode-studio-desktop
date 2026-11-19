use super::*;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
#[derive(Serialize)]
pub struct Account {
    pub id: String,
    pub address: String,
}
pub struct StoredDraft {
    pub recipient: String,
    pub subject: String,
    pub body: String,
}
pub struct Mailbox<'a> {
    db: &'a mut Connection,
    scope: String,
    account: Account,
}
fn db_err(_: rusqlite::Error) -> &'static str {
    "mail_storage"
}
impl<'a> Mailbox<'a> {
    /// scope must come from the native workspace/window binding. Never accept an SMTP sender from the renderer.
    pub fn open(db: &'a mut Connection, scope: &str, id: &str) -> Result<Self> {
        let account = db
            .query_row(
                "SELECT id,address FROM accounts WHERE scope=?1 AND id=?2 AND provider='alibaba'",
                params![scope, id],
                |r| {
                    Ok(Account {
                        id: r.get(0)?,
                        address: r.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(db_err)?
            .ok_or("mail_account_not_found")?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS alibaba_inbox(scope TEXT,account TEXT,epoch INTEGER,uid INTEGER,meta TEXT NOT NULL,body TEXT,PRIMARY KEY(scope,account,epoch,uid));
          CREATE TABLE IF NOT EXISTS alibaba_epoch(scope TEXT,account TEXT,epoch INTEGER NOT NULL,PRIMARY KEY(scope,account));
          CREATE TABLE IF NOT EXISTS alibaba_reply(scope TEXT,account TEXT,draft TEXT,parent TEXT,PRIMARY KEY(scope,account,draft));
          CREATE TRIGGER IF NOT EXISTS alibaba_delete_reply AFTER DELETE ON drafts BEGIN DELETE FROM alibaba_reply WHERE scope=OLD.scope AND account=OLD.account AND draft=OLD.id; END;
          CREATE TABLE IF NOT EXISTS alibaba_send(scope TEXT,account TEXT,draft TEXT,revision INTEGER,status TEXT NOT NULL,PRIMARY KEY(scope,account,draft,revision));").map_err(db_err)?;
        Ok(Self {
            db,
            scope: scope.into(),
            account,
        })
    }
    pub fn address(&self) -> &str {
        &self.account.address
    }
    pub fn sync(
        &mut self,
        adapter: &Alibaba,
        password: &str,
        cursor: Option<Cursor>,
        limit: u8,
    ) -> Result<Page> {
        let observed: Option<u32> = self
            .db
            .query_row(
                "SELECT epoch FROM alibaba_epoch WHERE scope=? AND account=?",
                params![self.scope, self.account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if cursor.is_some_and(|c| Some(c.uid_validity) != observed) {
            return Err("mail_inbox_changed");
        }
        let page = adapter.list(self.address(), password, cursor, limit)?;
        let tx = self.db.transaction().map_err(db_err)?;
        // A delayed older page must not switch the active cache back to a stale UIDVALIDITY.
        let current: Option<u32> = tx
            .query_row(
                "SELECT epoch FROM alibaba_epoch WHERE scope=? AND account=?",
                params![self.scope, self.account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if current != observed && current != Some(page.uid_validity) {
            return Err("mail_inbox_changed");
        }
        tx.execute("INSERT INTO alibaba_epoch VALUES(?,?,?) ON CONFLICT(scope,account) DO UPDATE SET epoch=excluded.epoch",params![self.scope,self.account.id,page.uid_validity]).map_err(db_err)?;
        for item in &page.messages {
            tx.execute("INSERT INTO alibaba_inbox(scope,account,epoch,uid,meta) VALUES(?,?,?,?,?) ON CONFLICT(scope,account,epoch,uid) DO UPDATE SET meta=excluded.meta",
            params![self.scope,self.account.id,page.uid_validity,item.uid,serde_json::to_string(item).map_err(|_|"mail_storage")?]).map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(page)
    }
    pub fn cached_page(&self, cursor: Option<Cursor>, limit: u8) -> Result<Page> {
        if !(1..=40).contains(&limit) {
            return Err("mail_invalid_page");
        }
        let epoch: u32 = self
            .db
            .query_row(
                "SELECT epoch FROM alibaba_epoch WHERE scope=? AND account=?",
                params![self.scope, self.account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .ok_or("mail_cache_empty")?;
        if cursor.is_some_and(|c| c.uid_validity != epoch || c.before == 0) {
            return Err("mail_inbox_changed");
        }
        let before = cursor.map_or(i64::from(u32::MAX) + 1, |c| c.before.into());
        let mut q=self.db.prepare("SELECT meta FROM alibaba_inbox WHERE scope=? AND account=? AND epoch=? AND uid<? ORDER BY uid DESC LIMIT ?").map_err(db_err)?;
        let encoded = q
            .query_map(
                params![
                    self.scope,
                    self.account.id,
                    epoch,
                    before,
                    i64::from(limit) + 1
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(db_err)?;
        let mut messages = Vec::<Summary>::new();
        for row in encoded {
            messages.push(serde_json::from_str(&row.map_err(db_err)?).map_err(|_| "mail_storage")?);
        }
        let more = messages.len() > usize::from(limit);
        messages.truncate(usize::from(limit));
        let next = if more {
            messages.last().map(|m| Cursor {
                uid_validity: epoch,
                before: m.uid,
            })
        } else {
            None
        };
        Ok(Page {
            uid_validity: epoch,
            messages,
            next,
        })
    }
    pub fn cached_body(&self, epoch: u32, uid: u32) -> Result<Letter> {
        let (meta,body):(String,Option<String>)=self.db.query_row("SELECT meta,body FROM alibaba_inbox WHERE scope=? AND account=? AND epoch=? AND uid=?",params![self.scope,self.account.id,epoch,uid],
          |r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(db_err)?.ok_or("mail_cache_empty")?;
        Ok(Letter {
            summary: serde_json::from_str(&meta).map_err(|_| "mail_storage")?,
            text: body.ok_or("mail_cache_empty")?,
        })
    }
    pub fn read(
        &mut self,
        adapter: &Alibaba,
        password: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Letter> {
        self.meta(epoch, uid)?;
        let letter = adapter.letter(self.address(), password, epoch, uid)?;
        self.db
            .execute(
                "UPDATE alibaba_inbox SET body=? WHERE scope=? AND account=? AND epoch=? AND uid=?",
                params![letter.text, self.scope, self.account.id, epoch, uid],
            )
            .map_err(db_err)?;
        Ok(letter)
    }
    fn meta(&self, epoch: u32, uid: u32) -> Result<Summary> {
        let meta: String = self
            .db
            .query_row(
                "SELECT meta FROM alibaba_inbox WHERE scope=? AND account=? AND epoch=? AND uid=?",
                params![self.scope, self.account.id, epoch, uid],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .ok_or("mail_cache_empty")?;
        serde_json::from_str(&meta).map_err(|_| "mail_storage")
    }
    pub fn reply_draft(&mut self, id: &str, epoch: u32, uid: u32) -> Result<serde_json::Value> {
        let original = self.meta(epoch, uid)?;
        let recipient = original.reply_to;
        if recipient.contains(['\r', '\n', '\0'])
            || recipient.parse::<lettre::message::Mailbox>().is_err()
        {
            return Err("mail_invalid_reply");
        }
        let mut subject = original.subject.replace(['\r', '\n', '\0'], " ");
        if !subject.to_ascii_lowercase().starts_with("re:") {
            subject = format!("Re: {subject}")
        }
        while subject.len() > 998 {
            subject.pop();
        }
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_err)?;
        tx.execute("INSERT INTO drafts(scope,account,id,revision,recipient,subject,body) VALUES(?,?,?,1,?,?,'')",params![self.scope,self.account.id,id,recipient,subject]).map_err(db_err)?;
        tx.execute(
            "INSERT INTO alibaba_reply VALUES(?,?,?,?)",
            params![self.scope, self.account.id, id, original.message_id],
        )
        .map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(
            serde_json::json!({"id":id,"revision":1,"recipient":recipient,"subject":subject,"body":""}),
        )
    }
    pub fn delivery(&self, draft: &str, revision: u64) -> Result<Option<String>> {
        self.db.query_row("SELECT status FROM alibaba_send WHERE scope=? AND account=? AND draft=? AND revision=?",params![self.scope,self.account.id,draft,revision],|r|r.get(0)).optional().map_err(db_err)
    }
    pub fn send(
        &mut self,
        adapter: &Alibaba,
        password: &str,
        draft: &str,
        revision: u64,
        confirmed: bool,
        reply: Option<(u32, u32)>,
    ) -> Result<String> {
        if !confirmed {
            return Err("mail_confirmation_required");
        }
        let parent = reply
            .map(|(e, u)| self.meta(e, u))
            .transpose()?
            .and_then(|m| m.message_id);
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_err)?;
        let saved=tx.query_row("SELECT recipient,subject,body FROM drafts WHERE scope=? AND account=? AND id=? AND revision=?",params![self.scope,self.account.id,draft,revision],
          |r|Ok(StoredDraft{recipient:r.get(0)?,subject:r.get(1)?,body:r.get(2)?})).optional().map_err(db_err)?.ok_or("mail_draft_changed")?;
        let stored_parent: Option<Option<String>> = tx
            .query_row(
                "SELECT parent FROM alibaba_reply WHERE scope=? AND account=? AND draft=?",
                params![self.scope, self.account.id, draft],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        let parent = stored_parent.unwrap_or(parent);
        let msg = adapter.compose(&self.account.address, &saved, parent.as_deref())?;
        // Unknown is committed *before* any network write. Crashes or lost final replies never cause replay.
        if tx
            .execute(
                "INSERT OR IGNORE INTO alibaba_send VALUES(?,?,?,?,'unknown')",
                params![self.scope, self.account.id, draft, revision],
            )
            .map_err(db_err)?
            != 1
        {
            return tx.query_row("SELECT status FROM alibaba_send WHERE scope=? AND account=? AND draft=? AND revision=?",params![self.scope,self.account.id,draft,revision],|r|r.get(0)).map_err(db_err);
        }
        tx.commit().map_err(db_err)?;
        let outcome = adapter.transmit(self.address(), password, msg)?;
        self.db.execute("UPDATE alibaba_send SET status=? WHERE scope=? AND account=? AND draft=? AND revision=?",params![outcome,self.scope,self.account.id,draft,revision]).map_err(db_err)?;
        Ok(outcome.into())
    }
}
