-- Legacy Sber Sandbox only. provider remains accepted for preceding-image rollback;
-- it is the participant's business characteristic, not the new base IAM role.
ALTER TABLE iam.role_assignments DROP CONSTRAINT role_assignments_role_check;
ALTER TABLE iam.role_assignments ADD CONSTRAINT role_assignments_role_check
  CHECK (role IN ('provider', 'individual'));

INSERT INTO iam.role_assignments(id, user_id, scope_type, scope_id, role)
SELECT gen_random_uuid(), p.individual_user_id, 'participant', p.id, 'individual'
FROM party.participants p JOIN iam.users u ON u.id=p.individual_user_id
WHERE p.kind='individual'
ON CONFLICT (user_id, scope_id, role) DO NOTHING;

DELETE FROM iam.role_assignments r USING party.participants p
WHERE r.role='provider' AND r.scope_type='participant' AND r.scope_id=p.id
  AND r.user_id=p.individual_user_id AND p.kind='individual';
