CREATE OR REPLACE FUNCTION prevent_audit_trail_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_trail_prevent_update_delete
BEFORE UPDATE OR DELETE ON "audit_trail"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_trail_mutation();

CREATE TRIGGER audit_trail_prevent_truncate
BEFORE TRUNCATE ON "audit_trail"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_audit_trail_mutation();
