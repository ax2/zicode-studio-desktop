CREATE TABLE IF NOT EXISTS alibaba_inbox(scope TEXT,account TEXT,folder TEXT NOT NULL,epoch INTEGER,uid INTEGER,meta TEXT NOT NULL,body TEXT,PRIMARY KEY(scope,account,folder,epoch,uid));
CREATE TABLE IF NOT EXISTS alibaba_attachments(scope TEXT,account TEXT,folder TEXT NOT NULL,epoch INTEGER,uid INTEGER,items TEXT NOT NULL,PRIMARY KEY(scope,account,folder,epoch,uid));
CREATE TRIGGER IF NOT EXISTS alibaba_delete_attachments AFTER DELETE ON alibaba_inbox BEGIN DELETE FROM alibaba_attachments WHERE scope=OLD.scope AND account=OLD.account AND folder=OLD.folder AND epoch=OLD.epoch AND uid=OLD.uid; END;
CREATE TABLE IF NOT EXISTS alibaba_html(scope TEXT,account TEXT,folder TEXT NOT NULL,epoch INTEGER,uid INTEGER,html TEXT NOT NULL,PRIMARY KEY(scope,account,folder,epoch,uid));
CREATE TRIGGER IF NOT EXISTS alibaba_delete_html AFTER DELETE ON alibaba_inbox BEGIN DELETE FROM alibaba_html WHERE scope=OLD.scope AND account=OLD.account AND folder=OLD.folder AND epoch=OLD.epoch AND uid=OLD.uid; END;
CREATE TABLE IF NOT EXISTS alibaba_epoch(scope TEXT,account TEXT,folder TEXT NOT NULL,epoch INTEGER NOT NULL,PRIMARY KEY(scope,account,folder));
