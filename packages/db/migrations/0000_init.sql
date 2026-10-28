CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    hashed_password TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    email_verified_at TIMESTAMPTZ,
    user_vector vector(1024),
    user_vector_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    topics JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(topics) = 'array'),
    excluded_topics JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(excluded_topics) = 'array'),
    language TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    url_hash CHAR(64) NOT NULL UNIQUE,
    source_type TEXT NOT NULL CHECK (source_type IN ('RSS', 'ATOM', 'JSON_FEED', 'API', 'READ_IT_LATER')),
    category TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    etag TEXT,
    last_modified TEXT,
    fetch_interval_minutes INT NOT NULL DEFAULT 60 CHECK (fetch_interval_minutes >= 15),
    next_fetch_at TIMESTAMPTZ,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_next_fetch_idx ON sources (is_active, next_fetch_at);
CREATE INDEX IF NOT EXISTS sources_owner_idx ON sources (owner_id);

CREATE TABLE IF NOT EXISTS user_sources (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, source_id)
);

CREATE INDEX IF NOT EXISTS user_sources_source_idx ON user_sources (source_id);

CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    original_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    url_hash CHAR(64) NOT NULL UNIQUE,
    content_hash CHAR(64),
    raw_content TEXT,
    cleaned_content TEXT,
    author TEXT,
    language TEXT,
    published_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'fetching', 'extracting', 'processing', 'ready', 'failed', 'skipped')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    retention_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_source_idx ON articles (source_id);
CREATE INDEX IF NOT EXISTS articles_status_idx ON articles (status);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC);

CREATE TABLE IF NOT EXISTS cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    hook TEXT NOT NULL,
    core_concept TEXT NOT NULL,
    key_takeaways JSONB NOT NULL CHECK (jsonb_typeof(key_takeaways) = 'array'),
    estimated_read_time_sec INT NOT NULL CHECK (estimated_read_time_sec > 0),
    embedding vector(1024),
    embedding_model TEXT,
    embedding_dim SMALLINT,
    topic_tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(topic_tags) = 'array'),
    language TEXT,
    recall_prompt TEXT,
    answer TEXT,
    generation_model TEXT,
    prompt_version TEXT,
    status TEXT NOT NULL DEFAULT 'published'
        CHECK (status IN ('draft', 'published', 'flagged', 'hidden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cards_article_language_prompt_key
    ON cards (article_id, language, prompt_version);
CREATE INDEX IF NOT EXISTS cards_article_idx ON cards (article_id);
CREATE INDEX IF NOT EXISTS cards_embedding_hnsw
    ON cards USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS cards_topic_tags_gin ON cards USING gin (topic_tags jsonb_path_ops);
CREATE INDEX IF NOT EXISTS cards_status_idx ON cards (status);
CREATE INDEX IF NOT EXISTS cards_created_idx ON cards (created_at DESC);

CREATE TABLE IF NOT EXISTS user_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    interaction_type TEXT NOT NULL
        CHECK (interaction_type IN ('VIEW', 'LIKE', 'DISMISS', 'CLICK_SOURCE', 'SAVE')),
    dwell_time_ms INT NOT NULL DEFAULT 0
        CHECK (dwell_time_ms >= 0 AND dwell_time_ms <= 300000),
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS user_interactions_user_idx ON user_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_interactions_card_idx ON user_interactions (card_id);

CREATE TABLE IF NOT EXISTS user_card_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    stability DOUBLE PRECISION NOT NULL DEFAULT 0,
    difficulty DOUBLE PRECISION NOT NULL DEFAULT 0,
    elapsed_days INT NOT NULL DEFAULT 0,
    scheduled_days INT NOT NULL DEFAULT 1,
    reps INT NOT NULL DEFAULT 0,
    lapses INT NOT NULL DEFAULT 0,
    state SMALLINT NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
    step INT NOT NULL DEFAULT 0,
    desired_retention DOUBLE PRECISION NOT NULL DEFAULT 0.9
        CHECK (desired_retention > 0 AND desired_retention <= 1),
    fsrs_params JSONB,
    last_review TIMESTAMPTZ,
    next_review TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS user_card_reviews_due_idx ON user_card_reviews (user_id, next_review);

CREATE TABLE IF NOT EXISTS card_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 4),
    state_before SMALLINT NOT NULL,
    state_after SMALLINT NOT NULL,
    stability_before DOUBLE PRECISION NOT NULL,
    stability_after DOUBLE PRECISION NOT NULL,
    difficulty_before DOUBLE PRECISION NOT NULL,
    difficulty_after DOUBLE PRECISION NOT NULL,
    elapsed_days INT NOT NULL,
    scheduled_days INT NOT NULL,
    idempotency_key TEXT NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS card_reviews_user_idx ON card_reviews (user_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS provider_usage (
    provider TEXT NOT NULL,
    metric TEXT NOT NULL,
    usage_date DATE NOT NULL,
    value BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, metric, usage_date)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at);
