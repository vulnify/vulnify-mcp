import { z } from 'zod';
import { DEFAULT_POLL_MS, MAX_WAIT_MS, MIN_POLL_MS } from './constants.js';

export const eventActionSchema = z
  .enum(['READ_DATA', 'WRITE_DATA', 'DELETE_DATA', 'EXPORT_DATA', 'SEND_EMAIL'])
  .describe('Event action. Allowed values: READ_DATA, WRITE_DATA, DELETE_DATA, EXPORT_DATA, SEND_EMAIL.');
export const eventDestinationSchema = z
  .enum(['INTERNAL', 'EXTERNAL_EMAIL', 'EXTERNAL_API'])
  .describe('Where the data goes. Allowed values: INTERNAL, EXTERNAL_EMAIL, EXTERNAL_API.');
export const decisionSchema = z.enum(['ALLOW', 'REVIEW', 'BLOCK']).describe('ALLOW, REVIEW, or BLOCK.');

const dlpTypeSchema = z.enum([
  'CPF',
  'CNPJ',
  'RG',
  'CNH',
  'PIX_KEY',
  'PHONE_BR',
  'CEP',
  'CREDIT_CARD',
  'EMAIL',
  'HEALTH_DATA',
  'API_KEY',
  'PRIVATE_KEY',
]);

const lgpdCategorySchema = z.enum([
  'IDENTIFICATION',
  'CONTACT',
  'LOCATION',
  'FINANCIAL',
  'HEALTH',
  'COMPANY',
  'CREDENTIALS',
]);

const conditionFields = {
  action: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Event action (READ_DATA and the others) or an action family. Matched against the event action and its family.'),
  destination: z
    .enum(['EXTERNAL', 'INTERNAL'])
    .optional()
    .describe('EXTERNAL matches an external destination. INTERNAL matches an internal one. This is not the event destination enum.'),
  destinationContains: z.string().max(100).optional().describe('Case-insensitive substring of the destination.'),
  containsSensitiveData: z.boolean().optional().describe('Whether the action is treated as containing sensitive data.'),
  minRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().describe('recordsAffected is greater than or equal to this value.'),
  maxRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().describe('recordsAffected is less than or equal to this value.'),
  minRiskScore: z.number().int().min(0).max(100).optional().describe('Risk score from 0 to 100. The condition matches at or above this score.'),
  outsideBusinessHours: z.boolean().optional().describe('Monday to Friday 09:00-18:00 in the organization time zone, inverted.'),
  agentIds: z.array(z.string()).max(100).optional().describe('Agent ids. The event agent must be one of these ids.'),
  dlpTypes: z
    .array(dlpTypeSchema)
    .optional()
    .describe('Sensitive-data types. Allowed values: CPF, CNPJ, RG, CNH, PIX_KEY, PHONE_BR, CEP, CREDIT_CARD, EMAIL, HEALTH_DATA, API_KEY, PRIVATE_KEY.'),
  lgpdCategories: z
    .array(lgpdCategorySchema)
    .optional()
    .describe('LGPD categories. Allowed values: IDENTIFICATION, CONTACT, LOCATION, FINANCIAL, HEALTH, COMPANY, CREDENTIALS.'),
};

export type PolicyCondition = {
  action?: string;
  destination?: 'EXTERNAL' | 'INTERNAL';
  destinationContains?: string;
  containsSensitiveData?: boolean;
  minRecords?: number;
  maxRecords?: number;
  minRiskScore?: number;
  outsideBusinessHours?: boolean;
  agentIds?: string[];
  dlpTypes?: Array<z.infer<typeof dlpTypeSchema>>;
  lgpdCategories?: Array<z.infer<typeof lgpdCategorySchema>>;
  allOf?: PolicyCondition[];
  anyOf?: PolicyCondition[];
};

export const policyConditionSchema: z.ZodType<PolicyCondition> = z.lazy(() =>
  z
    .object({
      ...conditionFields,
      allOf: z.array(policyConditionSchema).max(50).optional().describe('Matches when every nested condition matches. An empty allOf matches.'),
      anyOf: z.array(policyConditionSchema).max(50).optional().describe('Matches when at least one nested condition matches. An empty anyOf does not.'),
    })
    .strict(),
);

export const policySpecSchema = z
  .object({
    name: z.string().min(1).max(120).describe('Policy name. Unique in the organization.'),
    description: z.string().max(500).optional().describe('What the policy is for. Optional. At most 500 characters.'),
    enabled: z.boolean().optional().describe('Omitted defaults to true on the API.'),
    action: z.enum(['ANY', 'READ', 'WRITE', 'DELETE', 'EXPORT']).describe('Action family, not an event action such as EXPORT_DATA.'),
    resource: z
      .enum(['ANY', 'PUBLIC', 'INTERNAL', 'SENSITIVE', 'CUSTOMER_PII', 'FINANCIAL', 'EMPLOYEE'])
      .nullable()
      .optional()
      .describe('Resource classification. ANY, null, and omitted match every classification.'),
    condition: policyConditionSchema.optional().describe('When the policy matches. Omitted matches every event with this action and resource.'),
    decision: decisionSchema.describe('Result when the policy matches. Allowed values: ALLOW, REVIEW, or BLOCK.'),
    mode: z.enum(['ENFORCE', 'MONITOR']).optional().describe('Omitted defaults to ENFORCE on the API. Allowed values: ENFORCE, MONITOR.'),
    approverRoles: z
      .array(z.enum(['OWNER', 'ADMIN', 'MEMBER']))
      .max(3)
      .optional()
      .describe('Roles that may approve a REVIEW raised by this policy. Empty means owners and admins.'),
  })
  .strict();

export const policyTestInputSchema = z
  .object({
    agent: z.string().min(1).max(100).describe('Agent name registered in Vulnify. Ids are not accepted on the dry-run endpoint.'),
    action: eventActionSchema,
    resource: z.string().min(1).max(100).describe('Resource name registered in Vulnify, not the policy resource classification.'),
    destination: eventDestinationSchema.optional(),
    recordsAffected: z.number().int().min(0).max(100_000_000).optional().describe('How many records the action would touch. Optional. 0 to 100000000.'),
    containsSensitiveData: z.boolean().optional().describe('Whether the case is treated as containing sensitive data. The dry run does not scan content.'),
  })
  .strict();

export const policyTestCaseSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Case name. Returned with the result.'),
    input: policyTestInputSchema.describe('Action to evaluate. Agent, action, and resource are required. The dry run does not scan content.'),
    expect: z
      .object({
        decision: decisionSchema.describe('Expected decision. Allowed values: ALLOW, REVIEW, or BLOCK.'),
        policy: z.string().min(1).max(120).optional().describe('Expected matched policy name.'),
      })
      .strict()
      .optional()
      .describe('Expected decision and optional policy name. When omitted, pass is null.'),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\r\n]+$/)
  .describe('Retries with the same key return the stored decision for 24 hours instead of recording another event.');

export const checkActionInput = z
  .object({
    agent: z.string().min(1).max(100).describe('Agent name. The dry run does not accept agentId.'),
    action: eventActionSchema,
    resource: z.string().min(1).max(100).describe('Resource name. The dry run does not accept resourceId.'),
    destination: eventDestinationSchema.optional(),
    recordsAffected: z.number().int().min(0).max(100_000_000).optional().describe('How many records the action would touch. Optional. 0 to 100000000.'),
    containsSensitiveData: z.boolean().optional().describe('Hint for policy conditions. This call does not scan content.'),
  })
  .strict();

export const decideActionInput = z
  .object({
    agent: z.string().min(1).max(100).optional().describe('Agent name. Omit only when the API key is bound to an agent. Use this or agentId.'),
    agentId: z.string().uuid().optional().describe('Agent id. Use this or agent.'),
    action: eventActionSchema,
    resource: z.string().min(1).max(100).optional().describe('Resource name. Use this or resourceId.'),
    resourceId: z.string().uuid().optional().describe('Resource id. Use this or resource.'),
    destination: eventDestinationSchema.optional().describe('Where the data goes. Allowed values: INTERNAL, EXTERNAL_EMAIL, EXTERNAL_API.'),
    recordsAffected: z.number().int().min(0).max(100_000_000).optional().describe('How many records the action would touch. Optional. 0 to 100000000.'),
    content: z
      .string()
      .max(100_000)
      .optional()
      .describe('Optional text scanned for sensitive data. Scanned in memory by Vulnify and not stored. This server does not log it.'),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export const getDecisionInput = z
  .object({
    id: z.string().min(1).max(200).describe('Decision id returned by decide_action or check_mcp_tool_call.'),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(MAX_WAIT_MS)
      .optional()
      .describe(`When finalDecision is REVIEW, the server polls until finalDecision is ALLOW or BLOCK, or until this many milliseconds pass. Maximum ${MAX_WAIT_MS}. 0, or omitting the field, returns the current decision immediately.`),
    pollIntervalMs: z
      .number()
      .int()
      .min(MIN_POLL_MS)
      .max(5_000)
      .optional()
      .describe(`Milliseconds between polls. Default ${DEFAULT_POLL_MS}.`),
  })
  .strict();

export const listPoliciesInput = z.object({}).strict();

export const testPoliciesInput = z
  .object({
    policies: z
      .array(policySpecSchema)
      .max(200)
      .optional()
      .describe('When set, these policies are evaluated instead of the stored ones. Nothing is written.'),
    cases: z.array(policyTestCaseSchema).min(1).max(200).describe('One to 200 cases. Each case has a name, an input, and an optional expected decision.'),
  })
  .strict();

export const planPolicyChangesInput = z
  .object({
    policies: z.array(policySpecSchema).describe('Policies to diff against the stored set. Each item needs name, action, and decision. Nothing is written.'),
    prune: z.boolean().optional().describe('When true, the plan marks stored policies whose names are missing from policies for deletion. Nothing is deleted.'),
  })
  .strict();

export const checkMcpToolCallInput = z
  .object({
    tool: z.string().min(1).max(200).describe('Downstream MCP tool name. Vulnify maps it to an action by substring. The tool is not executed.'),
    arguments: z.record(z.string(), z.unknown()).optional().describe('Tool arguments. Not executed by Vulnify.'),
    agent: z.string().min(1).max(100).optional().describe('Agent name. Use this or agentId. A registered MCP route can supply a default agent.'),
    agentId: z.string().uuid().optional().describe('Agent id (UUID). Use this or agent.'),
    resource: z.string().min(1).max(100).optional().describe('Resource name registered in Vulnify. Use this or resourceId.'),
    resourceId: z.string().uuid().optional().describe('Resource id (UUID). Use this or resource.'),
    destination: eventDestinationSchema.optional(),
    recordsAffected: z.number().int().min(0).max(100_000_000).optional().describe('How many records the tool call would touch. Optional. 0 to 100000000.'),
    content: z.string().max(100_000).optional().describe('Optional text scanned for sensitive data. Scanned in memory and not stored. This server does not log it.'),
    routeId: z.string().uuid().optional().describe('Registered MCP route. Supplies a default agent.'),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export type CheckActionInput = z.infer<typeof checkActionInput>;
export type DecideActionInput = z.infer<typeof decideActionInput>;
export type GetDecisionInput = z.infer<typeof getDecisionInput>;
export type TestPoliciesInput = z.infer<typeof testPoliciesInput>;
export type PlanPolicyChangesInput = z.infer<typeof planPolicyChangesInput>;
export type CheckMcpToolCallInput = z.infer<typeof checkMcpToolCallInput>;
export type PolicySpec = z.infer<typeof policySpecSchema>;

const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape).catchall(z.unknown());

/** Recorded decision. Extra API fields are allowed. id and finalDecision are the stable required fields. */
export const decisionOutput = loose({
  id: z.string().describe('Decision id.'),
  finalDecision: decisionSchema.describe('Authoritative result. Allowed values: ALLOW, REVIEW, BLOCK.'),
});

export const getDecisionOutput = loose({
  id: z.string().describe('Decision id.'),
  finalDecision: decisionSchema.describe('Authoritative result. Allowed values: ALLOW, REVIEW, BLOCK.'),
  waitTimedOut: z.boolean().describe('True when the wait elapsed and finalDecision is still REVIEW.'),
});

/** POST /v1/policies/test. A result may include null matchedPolicy and null pass. */
export const policyTestOutput = loose({
  results: z
    .array(
      loose({
        name: z.string().describe('Case name.'),
        decision: decisionSchema,
      }),
    )
    .describe('One result per case.'),
});

export const policyListOutput = loose({
  apiVersion: z.literal('vulnify.io/v1').describe('Always vulnify.io/v1.'),
  policies: z.array(loose({ name: z.string().describe('Policy name.') })).describe('Stored policies sorted by name.'),
});

export const planOutput = loose({
  dryRun: z.boolean().describe('Always true. The plan is not applied.'),
  changes: z
    .array(
      loose({
        name: z.string().describe('Policy name.'),
        op: z.enum(['create', 'update', 'delete', 'unchanged']).describe('create, update, delete, or unchanged.'),
      }),
    )
    .describe('Creates, updates, deletes, and unchanged names.'),
});

export const listPendingReviewsInput = z
  .object({
    limit: z.number().int().min(1).max(50).optional().describe('How many pending reviews to return (1-50, default 20).'),
  })
  .strict();

const reviewIdSchema = z.string().uuid().describe('Review id: the event id from list_pending_reviews or decide_action.');

export const approveReviewInput = z
  .object({
    id: reviewIdSchema,
    mfaCode: z
      .string()
      .regex(/^\d{6}$/)
      .describe(
        'The current 6-digit code from the authenticator app of the person approving. Ask the person for it in this conversation every time. Never guess, reuse or invent a code.',
      ),
    note: z.string().max(500).optional().describe('Why the person approved, in their words. Stored in the audit log.'),
  })
  .strict();

export const denyReviewInput = z
  .object({
    id: reviewIdSchema,
    note: z.string().max(500).optional().describe('Why the person denied, in their words. Stored in the audit log.'),
  })
  .strict();

export type ListPendingReviewsInput = z.infer<typeof listPendingReviewsInput>;
export type ApproveReviewInput = z.infer<typeof approveReviewInput>;
export type DenyReviewInput = z.infer<typeof denyReviewInput>;
