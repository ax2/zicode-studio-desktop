CREATE TABLE IF NOT EXISTS draft_attachments (
    scope TEXT NOT NULL,
    account TEXT NOT NULL,
    draft TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (scope, account, draft, id),
    FOREIGN KEY (scope, account, draft) REFERENCES drafts(scope, account, id) ON DELETE CASCADE
);
