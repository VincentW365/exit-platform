/**
 * The synthetic recipient table the Stage 4 seed writes (Directive 4 D.6:
 * capture destinations only, never a real address), shared with the
 * application so a seeded address the data key can no longer read can be
 * repaired from it (DEC-073). A row is recognised as seeded by the seed's
 * change reason, its environment and its mask - a hand-entered address never
 * matches and is never touched.
 */
export const SEED_ENVIRONMENT = 'development';
export const SEED_CHANGE_REASON =
  'Synthetic development seed (Stage 4) - capture destinations only.';

export const DEV_RECIPIENTS = [
  {
    recipientClass: 'IT_OFFBOARDING',
    displayName: 'DEV IT offboarding mailbox',
    destination: 'capture://it-offboarding',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'FINANCE_OFFBOARDING',
    displayName: 'DEV Finance offboarding mailbox',
    destination: 'capture://finance-offboarding',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'HR_OFFBOARDING',
    displayName: 'DEV HR offboarding mailbox',
    destination: 'capture://hr-offboarding',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'LINE_MANAGER',
    displayName: 'DEV line-manager mailbox',
    destination: 'capture://line-manager',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  {
    recipientClass: 'SAGICOR_GROUP_HEALTH',
    displayName: 'DEV Sagicor capture (synthetic)',
    destination: 'capture://sagicor-group-health',
    purpose: 'GROUP_HEALTH_REMOVAL',
    organizationName: 'Sagicor (synthetic)',
    contactName: 'Group Benefits Team',
  },
  {
    recipientClass: 'NCB_GROUP_LIFE',
    displayName: 'DEV NCB capture (synthetic)',
    destination: 'capture://ncb-group-life',
    purpose: 'GROUP_LIFE_REMOVAL',
    organizationName: 'NCB Insurance (synthetic)',
    contactName: 'Group Life Team',
  },
  {
    recipientClass: 'EMPLOYEE_PERSONAL',
    displayName: 'DEV employee capture (synthetic)',
    destination: 'capture://employee-personal',
    purpose: null,
    organizationName: null,
    contactName: null,
  },
  // Directive 6.3 N: independently configurable provider purposes.
  {
    recipientClass: 'PAYROLL_BANK',
    displayName: 'DEV payroll/bank capture (synthetic)',
    destination: 'capture://payroll-bank',
    purpose: 'PAYROLL_OR_BANK_NOTIFICATION',
    organizationName: 'NCB Bank (synthetic)',
    contactName: 'Payroll Services Team',
  },
  {
    recipientClass: 'OTHER_APPROVED_EXTERNAL',
    displayName: 'DEV other approved provider capture (synthetic)',
    destination: 'capture://other-approved-external',
    purpose: 'OTHER_APPROVED_PROVIDER',
    organizationName: 'Other approved provider (synthetic)',
    contactName: 'Provider Contact Team',
  },
  // Email routing directive: the remaining departmental destinations, so an
  // administrator can route any notification type without touching code.
  {
    recipientClass: 'HR_OFFICERS',
    displayName: 'DEV HR Officers capture (synthetic)',
    destination: 'capture://hr-officers',
    purpose: null,
    organizationName: null,
    contactName: 'HR Officers',
  },
  {
    recipientClass: 'PAYROLL',
    displayName: 'DEV Payroll capture (synthetic)',
    destination: 'capture://payroll',
    purpose: null,
    organizationName: null,
    contactName: 'Payroll Team',
  },
  {
    recipientClass: 'SECURITY',
    displayName: 'DEV Security capture (synthetic)',
    destination: 'capture://security',
    purpose: null,
    organizationName: null,
    contactName: 'Security Team',
  },
  {
    recipientClass: 'ASSET_WAREHOUSE',
    displayName: 'DEV Asset / Warehouse capture (synthetic)',
    destination: 'capture://asset-warehouse',
    purpose: null,
    organizationName: null,
    contactName: 'Asset and Warehouse Team',
  },
] as const;

export type SyntheticRecipient = (typeof DEV_RECIPIENTS)[number];
