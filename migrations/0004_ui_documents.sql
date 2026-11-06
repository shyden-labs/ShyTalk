-- The app's UI document (plan 4 Task 6, shyden-labs/ShyTalk#79): every
-- published version, newest highest. A publish takes the next version inside
-- its INSERT and writes its audit row in the same batch. `undoes` names the
-- version an undo took away (Task 7).
CREATE TABLE ui_documents (
  version INTEGER PRIMARY KEY,
  body TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('named', 'share', 'everyone')),
  share INTEGER,
  undoes INTEGER,
  published_at INTEGER NOT NULL,
  published_by TEXT NOT NULL
);

CREATE INDEX ui_documents_by_audience ON ui_documents (audience, version);
