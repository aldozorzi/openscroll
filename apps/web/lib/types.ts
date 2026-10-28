import type { FeedCard, SourceType } from '@openscroll/contracts';

export interface SavedCard extends FeedCard {
  saved_at: string;
}

export interface CardDetail {
  card: {
    id: string;
    article_id: string;
    hook: string;
    core_concept: string;
    key_takeaways: string[];
    topic_tags: string[];
    language: string | null;
    estimated_read_time_sec: number;
    created_at: string;
    status: string;
    saved: boolean;
    source: {
      id: string | null;
      title: string | null;
      url: string | null;
    };
    article: {
      title: string | null;
      original_url: string | null;
      published_at: string | null;
    };
    review: {
      state: number;
      next_review: string;
      last_review: string | null;
      stability: number;
      difficulty: number;
    } | null;
  };
}

export interface SourceSummary {
  id: string;
  owner_id: string | null;
  title: string;
  url: string;
  source_type: SourceType;
  category: string | null;
  is_public: boolean;
  is_active: boolean;
  subscribed: boolean;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  article_count?: number;
  created_at: string;
}

export interface SourceStatus {
  source_id: string;
  status: 'pending' | 'ready';
  is_active: boolean;
  subscribed: boolean;
  article_count: number;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  latest_error: string | null;
}
