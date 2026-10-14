-- Email verification. A user only becomes active (and claims pending invites)
-- once their email is verified: password sign-ups by an emailed link, OAuth
-- sign-ups by the provider. Existing accounts are treated as verified.

UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;
--> statement-breakpoint

DROP TRIGGER users_claim_invites ON users;
--> statement-breakpoint
CREATE TRIGGER users_claim_invites AFTER INSERT ON users
FOR EACH ROW WHEN (NEW.email_verified_at IS NOT NULL) EXECUTE FUNCTION app.claim_invites();
--> statement-breakpoint
CREATE TRIGGER users_claim_invites_on_verify AFTER UPDATE OF email_verified_at ON users
FOR EACH ROW WHEN (OLD.email_verified_at IS NULL AND NEW.email_verified_at IS NOT NULL)
EXECUTE FUNCTION app.claim_invites();
