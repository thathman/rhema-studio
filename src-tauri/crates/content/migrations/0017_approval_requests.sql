-- Typed approval requests (C3, docs/contracts/host-permissions-v1.md slice 3). The host is the only
-- writer: a desk submits, a different person decides, once, before the request expires. The rules
-- that must never be broken live in the schema too, not only in the code.
CREATE TABLE IF NOT EXISTS approval_requests (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    target_id       TEXT NOT NULL,
    base_revision   INTEGER,
    requester_id    TEXT NOT NULL,
    requester_name  TEXT NOT NULL,
    payload         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    reason          TEXT,
    state           TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN
                        ('submitted', 'approved', 'declined', 'requested_changes', 'applied', 'expired', 'withdrawn', 'superseded')),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at      TEXT NOT NULL,
    decided_by_id   TEXT,
    decided_by_name TEXT,
    decided_at      TEXT,
    decision_note   TEXT,
    -- Nobody approves their own request.
    CHECK (decided_by_id IS NULL OR decided_by_id <> requester_id)
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_state ON approval_requests(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_target ON approval_requests(target_id, state);

-- Every step of every request, in order. Append-only: the history cannot be edited or erased.
CREATE TABLE IF NOT EXISTS approval_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  TEXT NOT NULL REFERENCES approval_requests(id),
    at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    actor_id    TEXT NOT NULL,
    actor_name  TEXT NOT NULL,
    action      TEXT NOT NULL,
    detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_events_request ON approval_events(request_id, seq);
CREATE TRIGGER IF NOT EXISTS approval_events_append_only_update BEFORE UPDATE ON approval_events
BEGIN SELECT RAISE(ABORT, 'approval history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS approval_events_append_only_delete BEFORE DELETE ON approval_events
BEGIN SELECT RAISE(ABORT, 'approval history is append-only'); END;
