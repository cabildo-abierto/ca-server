-- enable unaccent (needs CREATE EXTENSION privilege)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- immutable wrapper around unaccent (so we can index the expression)
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
SELECT unaccent($1);
$$ LANGUAGE SQL IMMUTABLE;

-- create the functional GIN index (CONCURRENTLY to avoid locking large tables)
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_text_fts_idx
    ON "Content"
    USING GIN (to_tsvector('simple', immutable_unaccent("text")));
