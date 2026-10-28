-- Private sources are scoped per owner: two users can register the same private
-- feed URL as separate rows. Public sources keep one canonical row per URL.
--
-- The original unique constraint is named "sources_url_hash_key" by PostgreSQL
-- (the column was declared inline as UNIQUE); Drizzle's generated name is
-- dropped too so this migration also applies to databases created from the
-- Drizzle snapshot.
ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_url_hash_key";--> statement-breakpoint
ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_url_hash_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "sources_public_url_key" ON "sources" USING btree ("url_hash") WHERE "sources"."is_public" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_private_owner_url_key" ON "sources" USING btree ("owner_id","url_hash") WHERE "sources"."is_public" = false;
