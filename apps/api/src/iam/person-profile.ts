// The public UI profile is an explicit canonical allowlist. Provider identifiers,
// snapshots, verification metadata and tokens cannot enter this projection.
export const canonicalProfileFields = [
  'email','phone_number','birthdate','family_name','given_name','middle_name','gender',
  'identification','inn','snils','driving_license','international_passport','priority_doc',
  'citizenship','place_of_birth','address_reg','work_address','address_of_actual_residence',
  'delivery_address','address','sts','previous_identification','previous_family_name',
  'previous_given_name','previous_middle_name','education','place_of_work','job_title',
  'marital_status','is_self_employed',
] as const;
export type PersonProfile = Partial<Record<typeof canonicalProfileFields[number],unknown>>;
