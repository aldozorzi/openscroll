ALTER TABLE "user_interactions" DROP CONSTRAINT IF EXISTS "user_interactions_interaction_type_check";
ALTER TABLE "user_interactions" ADD CONSTRAINT "user_interactions_interaction_type_check" 
  CHECK (interaction_type IN ('VIEW', 'LIKE', 'DISLIKE', 'DISMISS', 'CLICK_SOURCE', 'SAVE'));
