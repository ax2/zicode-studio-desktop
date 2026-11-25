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
    generation: i64,
    folder: String,
}
fn db_err(_: rusqlite::Error) -> &'static str {
    "mail_storage"
}
fn advance_cache_generation(db: &Connection, scope: &str, account: &str) -> Result<()> {
    db.execute(
        "INSERT INTO alibaba_cache_generation VALUES(?,?,1)
         ON CONFLICT(scope,account) DO UPDATE SET generation=generation+1",
        params![scope, account],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn initialize_cache(db: &mut Connection) -> Result<()> {
    let migrated: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('alibaba_inbox') WHERE name='folder')", [], |r| r.get(0)).map_err(db_err)?;
    if migrated { return Ok(()); }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_err)?;
    let old: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('alibaba_inbox')) AND NOT EXISTS(SELECT 1 FROM pragma_table_info('alibaba_inbox') WHERE name='folder')", [], |r| r.get(0)).map_err(db_err)?;
    let mut migrated_tables = Vec::new();
    if old {
        tx.execute_batch("DROP TRIGGER IF EXISTS alibaba_delete_html;
            DROP TRIGGER IF EXISTS alibaba_delete_attachments;").map_err(db_err)?;
        for (table, columns) in [
            ("alibaba_inbox", "epoch,uid,meta,body"),
            ("alibaba_epoch", "epoch"),
            ("alibaba_html", "epoch,uid,html"),
            ("alibaba_attachments", "epoch,uid,items"),
        ] {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)", [table], |r| r.get(0)).map_err(db_err)?;
            if exists {
                tx.execute_batch(&format!("ALTER TABLE {table} RENAME TO {table}_legacy")).map_err(db_err)?;
                migrated_tables.push((table, columns));
            }
        }
    }
    tx.execute_batch(include_str!("folder-cache.sql")).map_err(db_err)?;
    for (table, columns) in migrated_tables {
        tx.execute_batch(&format!("INSERT INTO {table}(scope,account,folder,{columns}) SELECT scope,account,'INBOX',{columns} FROM {table}_legacy;
            DROP TABLE {table}_legacy;")).map_err(db_err)?;
    }
    tx.commit().map_err(db_err)
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
        initialize_cache(db)?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS alibaba_sync_gap(scope TEXT,account TEXT,folder TEXT,epoch INTEGER,floor INTEGER,resume_before INTEGER NOT NULL,PRIMARY KEY(scope,account,folder,epoch,floor));
          CREATE TABLE IF NOT EXISTS alibaba_sync_revision(scope TEXT,account TEXT,folder TEXT,revision INTEGER NOT NULL,PRIMARY KEY(scope,account,folder));
          CREATE TABLE IF NOT EXISTS alibaba_folders(scope TEXT,account TEXT,folders TEXT NOT NULL,PRIMARY KEY(scope,account));
          CREATE TABLE IF NOT EXISTS alibaba_cache_generation(scope TEXT NOT NULL,account TEXT NOT NULL,generation INTEGER NOT NULL,PRIMARY KEY(scope,account));
          CREATE TABLE IF NOT EXISTS alibaba_reply(scope TEXT,account TEXT,draft TEXT,parent TEXT,PRIMARY KEY(scope,account,draft));
          CREATE TRIGGER IF NOT EXISTS alibaba_delete_reply AFTER DELETE ON drafts BEGIN DELETE FROM alibaba_reply WHERE scope=OLD.scope AND account=OLD.account AND draft=OLD.id; END;
          CREATE TABLE IF NOT EXISTS alibaba_send(scope TEXT,account TEXT,draft TEXT,revision INTEGER,status TEXT NOT NULL,PRIMARY KEY(scope,account,draft,revision));").map_err(db_err)?;
        let generation=db.query_row("SELECT COALESCE((SELECT generation FROM alibaba_cache_generation WHERE scope=? AND account=?),0)",params![scope,id],|r| r.get(0)).map_err(db_err)?;
        Ok(Self {
            folder: "INBOX".into(),
            generation,
            db,
            scope: scope.into(),
            account,
        })
    }
    pub fn select_folder(&mut self, folder: &str) -> Result<()> {
        if folder.is_empty() || folder.chars().any(char::is_control) { return Err("mail_invalid_folder"); }
        self.folder = if folder.eq_ignore_ascii_case("INBOX") { "INBOX".into() } else { folder.into() };
        Ok(())
    }
    pub fn folder(&self) -> &str { &self.folder }
    pub fn attachment_is_current(&self, epoch: u32) -> Result<()> {
        let current: bool = self.db.query_row("SELECT EXISTS(SELECT 1 FROM alibaba_epoch WHERE scope=?1 AND account=?2 AND folder=?5 AND epoch=?3) AND COALESCE((SELECT generation FROM alibaba_cache_generation WHERE scope=?1 AND account=?2),0)=?4",
            params![self.scope,self.account.id,epoch,self.generation,self.folder],|r|r.get(0)).map_err(db_err)?;
        if current {Ok(())} else {Err("mail_attachment_changed")}
    }
    pub fn read_attachment(
        &self,
        adapter: &Alibaba,
        password: &str,
        epoch: u32,
        uid: u32,
        expected: &Attachment,
    ) -> Result<Vec<u8>> {
        // Credentials are read separately by the Host. Recheck at the network boundary.
        self.attachment_is_current(epoch)?;
        adapter.attachment(self.address(), password, self.folder(), epoch, uid, expected)
    }
    /// Invalidate pending operations while retaining offline messages.
    pub fn invalidate_pending_operations(&self) -> Result<()> {
        advance_cache_generation(self.db, &self.scope, &self.account.id)
    }
    pub fn clear_cache(&mut self) -> Result<()> {
        let tx = self.db.transaction().map_err(db_err)?;
        advance_cache_generation(&tx, &self.scope, &self.account.id)?;
        for table in ["alibaba_inbox", "alibaba_epoch", "alibaba_folders", "alibaba_sync_revision", "alibaba_sync_gap"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE scope=? AND account=?"),
                params![self.scope, self.account.id],
            )
            .map_err(db_err)?;
        }
        tx.commit().map_err(db_err)
    }
    pub fn folders(&self, adapter: &Alibaba, password: &str) -> Result<Vec<Folder>> {
        let folders = adapter.folders(self.address(), password)?;
        let rows = self.db.execute("INSERT INTO alibaba_folders SELECT ?1,?2,?3 WHERE ?4=COALESCE((SELECT generation FROM alibaba_cache_generation WHERE scope=?1 AND account=?2),0) ON CONFLICT(scope,account) DO UPDATE SET folders=excluded.folders",
            params![self.scope,self.account.id,serde_json::to_string(&folders).map_err(|_| "mail_storage")?,self.generation]).map_err(db_err)?;
        if rows == 0 { return Err("mail_cache_changed"); }
        Ok(folders)
    }
    pub fn cached_folders(&self) -> Result<Vec<Folder>> {
        let data: Option<String> = self.db.query_row("SELECT folders FROM alibaba_folders WHERE scope=? AND account=?",params![self.scope,self.account.id],|row|row.get(0)).optional().map_err(db_err)?;
        match data {
            Some(text) => serde_json::from_str(&text).map_err(|_| "mail_storage"),
            None => Ok(Vec::new()),
        }
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
        self.sync_page(adapter, password, cursor, limit, None)
    }
    pub fn catch_up(&mut self, adapter: &Alibaba, password: &str, limit:u8) -> Result<bool> {
        let gap: Option<(u32,u32,u32)> = self.db.query_row(
            "SELECT epoch,floor,resume_before FROM alibaba_sync_gap WHERE scope=? AND account=? AND folder=? ORDER BY floor LIMIT 1",
            params![self.scope,self.account.id,self.folder], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))
        ).optional().map_err(db_err)?;
        let Some((epoch,floor,before)) = gap else { return Ok(false); };
        let cursor = Cursor { folder: (self.folder != "INBOX").then(|| self.folder.clone()), uid_validity:epoch, before };
        Ok(self.sync_page(adapter,password,Some(cursor),limit,Some(floor))?.pending)
    }
    fn sync_page(&mut self, adapter:&Alibaba, password:&str, cursor:Option<Cursor>, limit:u8, gap_floor:Option<u32>) -> Result<Page> {
        let before = cursor.as_ref().map(|c|c.before);
        let generation = self.generation;
        let revision: i64 = self.db.query_row("SELECT COALESCE((SELECT revision FROM alibaba_sync_revision WHERE scope=? AND account=? AND folder=?),0)",
            params![self.scope,self.account.id,self.folder], |row| row.get(0)).map_err(db_err)?;
        let observed: Option<u32> = self
            .db
            .query_row(
                "SELECT epoch FROM alibaba_epoch WHERE scope=? AND account=? AND folder=?",
                params![self.scope, self.account.id, self.folder],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if cursor.as_ref().is_some_and(|c| c.folder.as_deref().unwrap_or("INBOX") != self.folder || Some(c.uid_validity) != observed) {
            return Err("mail_inbox_changed");
        }
        let cached = if cursor.is_none() && observed.is_some() {
            let mut rows = self.db.prepare("SELECT uid FROM alibaba_inbox WHERE scope=? AND account=? AND folder=? AND epoch=?").map_err(db_err)?;
            let ids = rows.query_map(params![self.scope,self.account.id,self.folder,observed], |r| r.get(0)).map_err(db_err)?;
            ids.collect::<std::result::Result<Vec<u32>,_>>().map_err(db_err)?
        } else { Vec::new() };
        let (mut page, removed) = adapter.list(
            self.address(),
            password,
            &self.folder,
            cursor,
            limit,
            observed.map(|epoch| (epoch, cached.as_slice())),
        )?;
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_err)?;
        let current_generation:i64=tx.query_row("SELECT COALESCE((SELECT generation FROM alibaba_cache_generation WHERE scope=? AND account=?),0)",params![self.scope,self.account.id],|r|r.get(0)).map_err(db_err)?;
        if current_generation != generation {
            return Err("mail_inbox_changed");
        }
        let claimed = tx.execute("INSERT INTO alibaba_sync_revision VALUES(?1,?2,?3,1)
            ON CONFLICT(scope,account,folder) DO UPDATE SET revision=revision+1 WHERE revision=?4",
            params![self.scope,self.account.id,self.folder,revision]).map_err(db_err)?;
        if claimed == 0 { return Err("mail_inbox_changed"); }
        // A delayed older page must not switch the active cache back to a stale UIDVALIDITY.
        let current: Option<u32> = tx
            .query_row(
                "SELECT epoch FROM alibaba_epoch WHERE scope=? AND account=? AND folder=?",
                params![self.scope, self.account.id, self.folder],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?;
        if current != observed && current != Some(page.uid_validity) {
            return Err("mail_inbox_changed");
        }
        if current != Some(page.uid_validity) {
            tx.execute("DELETE FROM alibaba_sync_gap WHERE scope=? AND account=? AND folder=?",params![self.scope,self.account.id,self.folder]).map_err(db_err)?;
            tx.execute("DELETE FROM alibaba_inbox WHERE scope=? AND account=? AND folder=? AND epoch<>?",
                params![self.scope,self.account.id,self.folder,page.uid_validity]).map_err(db_err)?;
        }
        tx.execute("INSERT INTO alibaba_epoch(scope,account,folder,epoch) VALUES(?,?,?,?) ON CONFLICT(scope,account,folder) DO UPDATE SET epoch=excluded.epoch",params![self.scope,self.account.id,self.folder,page.uid_validity]).map_err(db_err)?;
        if current == Some(page.uid_validity) && !removed.is_empty() {
            let mut delete = tx.prepare("DELETE FROM alibaba_inbox WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid=?").map_err(db_err)?;
            for uid in removed {
                delete.execute(params![self.scope,self.account.id,self.folder,page.uid_validity,uid]).map_err(db_err)?;
            }
        }
        if let Some(floor) = gap_floor {
            // Consume the exact checkpoint read before the network request.
            let changed = tx.execute("DELETE FROM alibaba_sync_gap WHERE scope=? AND account=? AND folder=? AND epoch=? AND floor=? AND resume_before=?",
                params![self.scope,self.account.id,self.folder,page.uid_validity,floor,before]).map_err(db_err)?;
            if changed != 1 { return Err("mail_inbox_changed"); }
        }
        if observed == Some(page.uid_validity) {
            let floor = gap_floor.or_else(|| before.is_none().then(|| cached.iter().copied().max().unwrap_or(0)));
            if let (Some(floor),Some(next)) = (floor,&page.next) {
                if next.before.saturating_sub(floor)>1 {
                    tx.execute("INSERT OR IGNORE INTO alibaba_sync_gap VALUES(?,?,?,?,?,?)",
                        params![self.scope,self.account.id,self.folder,page.uid_validity,floor,next.before]).map_err(db_err)?;
                }
            }
        }
        for item in &page.messages {
            if gap_floor.is_some_and(|floor|item.uid<=floor) { continue; }
            tx.execute("INSERT INTO alibaba_inbox(scope,account,folder,epoch,uid,meta) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,account,folder,epoch,uid) DO UPDATE SET meta=excluded.meta",
            params![self.scope,self.account.id,self.folder,page.uid_validity,item.uid,serde_json::to_string(item).map_err(|_|"mail_storage")?]).map_err(db_err)?;
        }
        page.pending = tx.query_row("SELECT EXISTS(SELECT 1 FROM alibaba_sync_gap WHERE scope=? AND account=? AND folder=?)",
            params![self.scope,self.account.id,self.folder],|r|r.get(0)).map_err(db_err)?;
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
                "SELECT epoch FROM alibaba_epoch WHERE scope=? AND account=? AND folder=?",
                params![self.scope, self.account.id, self.folder],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_err)?
            .ok_or("mail_cache_empty")?;
        if cursor.as_ref().is_some_and(|c| c.folder.as_deref().unwrap_or("INBOX") != self.folder || c.uid_validity != epoch || c.before == 0) {
            return Err("mail_inbox_changed");
        }
        let before = cursor.map_or(i64::from(u32::MAX) + 1, |c| c.before.into());
        let mut q=self.db.prepare("SELECT meta FROM alibaba_inbox WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid<? ORDER BY uid DESC LIMIT ?").map_err(db_err)?;
        let encoded = q
            .query_map(
                params![
                    self.scope,
                    self.account.id,
                    self.folder,
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
                folder: (self.folder != "INBOX").then(|| self.folder.clone()),
                before: m.uid,
            })
        } else {
            None
        };
        Ok(Page {
            pending: false,
            uid_validity: epoch,
            messages,
            next,
        })
    }
    pub fn cached_body(&self, epoch: u32, uid: u32) -> Result<Letter> {
        let (meta,body,html):(String,Option<String>,Option<String>)=self.db.query_row("SELECT meta,body,html FROM alibaba_inbox LEFT JOIN alibaba_html USING(scope,account,folder,epoch,uid) WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid=?",params![self.scope,self.account.id,self.folder,epoch,uid],
          |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(db_err)?.ok_or("mail_cache_empty")?;
        let items: Option<String> = self.db.query_row("SELECT items FROM alibaba_attachments WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid=?",params![self.scope,self.account.id,self.folder,epoch,uid],|r|r.get(0)).optional().map_err(db_err)?;
        let (body_limited, attachments) = items.map(|json| serde_json::from_str(&json)).transpose().map_err(|_| "mail_storage")?.unwrap_or_default();
        Ok(Letter {
            attachments, body_limited,
            summary: serde_json::from_str(&meta).map_err(|_| "mail_storage")?,
            html,
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
        let generation = self.generation;
        self.meta(epoch, uid)?;
        let letter = adapter.letter(self.address(), password, &self.folder, epoch, uid)?;
        let tx = self.db.transaction().map_err(db_err)?;
        let updated=tx
            .execute(
                "UPDATE alibaba_inbox SET body=? WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid=? AND ?=COALESCE((SELECT generation FROM alibaba_cache_generation WHERE scope=? AND account=?),0)",
                params![letter.text, self.scope, self.account.id, self.folder, epoch, uid,generation,self.scope,self.account.id],
            )
            .map_err(db_err)?;
        if updated != 1 {
            return Err("mail_inbox_changed");
        }
        tx.execute("INSERT OR REPLACE INTO alibaba_attachments(scope,account,folder,epoch,uid,items) VALUES(?,?,?,?,?,?)",params![self.scope,self.account.id,self.folder,epoch,uid,serde_json::to_string(&(letter.body_limited,&letter.attachments)).map_err(|_|"mail_storage")?]).map_err(db_err)?;
        if let Some(html) = &letter.html {
            tx.execute("INSERT OR REPLACE INTO alibaba_html(scope,account,folder,epoch,uid,html) VALUES(?,?,?,?,?,?)",params![self.scope,self.account.id,self.folder,epoch,uid,html]).map_err(db_err)?;
        } else {
            tx.execute("DELETE FROM alibaba_html WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid=?",params![self.scope,self.account.id,self.folder,epoch,uid]).map_err(db_err)?;
        }
        tx.commit().map_err(db_err)?;
        Ok(letter)
    }
    fn meta(&self, epoch: u32, uid: u32) -> Result<Summary> {
        let meta: String = self
            .db
            .query_row(
                "SELECT meta FROM alibaba_inbox WHERE scope=? AND account=? AND folder=? AND epoch=? AND uid=?",
                params![self.scope, self.account.id, self.folder, epoch, uid],
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
        let files = draft_attachments(&tx, &self.scope, &self.account.id, draft)?;
        let msg = adapter.compose(&self.account.address, &saved, parent.as_deref(), files)?;
        // Claim before dialing. Only a proven pre-submission failure permits another confirmed attempt.
        if tx
            .execute(
                "INSERT INTO alibaba_send VALUES(?,?,?,?,'unknown')
                 ON CONFLICT(scope,account,draft,revision) DO UPDATE SET status=excluded.status
                 WHERE alibaba_send.status='not_submitted'",
                params![self.scope, self.account.id, draft, revision],
            )
            .map_err(db_err)?
            != 1
        {
            return tx.query_row("SELECT status FROM alibaba_send WHERE scope=? AND account=? AND draft=? AND revision=?",params![self.scope,self.account.id,draft,revision],|r|r.get(0)).map_err(db_err);
        }
        tx.commit().map_err(db_err)?;
        let outcome = adapter.transmit(self.address(), password, msg);
        self.db.execute("UPDATE alibaba_send SET status=? WHERE scope=? AND account=? AND draft=? AND revision=?",params![outcome,self.scope,self.account.id,draft,revision]).map_err(db_err)?;
        Ok(outcome.into())
    }
}
