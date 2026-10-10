import { z } from 'zod';
import { DEFAULT_POLL_MS, MAX_WAIT_MS, MIN_POLL_MS } from './constants.js';

export const eventActionSchema = z.enum(['READ_DATA', 'WRITE_DATA', 'DELETE_DATA', 'EXPORT_DATA', 'SEND_EMAIL']);
export const eventDestinationSchema = z.enum(['INTERNAL', 'EXTERNAL_EMAIL', 'EXTERNAL_API']);
export const decisionSchema = z.enum(['ALLOW', 'REVIEW', 'BLOCK']);

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
  containsSensitiveData: z.boolean().optional(),
  minRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().describe('recordsAffected is greater than or equal to this value.'),
  maxRecords: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().describe('recordsAffected is less than or equal to this value.'),
  minRiskScore: z.number().int().min(0).max(100).optional(),
  outsideBusinessHours: z.boolean().optional().describe('Monday to Friday 09:00-18:00 in the organization time zone, inverted.'),
  agentIds: z.array(z.string()).max(100).optional(),
  dlpTypes: z.array(dlpTypeSchema).optional(),
  lgpdCategories: z.array(lgpdCategorySchema).optional(),
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
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    enabled: z.boolean().optional().describe('Omitted defaults to true on the API.'),
    action: z.enum(['ANY', 'READ', 'WRITE', 'DELETE', 'EXPORT']).describe('Action family, not an event action such as EXPORT_DATA.'),
    resource: z
      .enum(['ANY', 'PUBLIC', 'INTERNAL', 'SENSITIVE', 'CUSTOMER_PII', 'FINANCIAL', 'EMPLOYEE'])
      .nullable()
      .optional()
      .describe('Resource classification. ANY, null, and omitted match every classification.'),
    condition: policyConditionSchema.optional(),
    decision: decisionSchema,
    mode: z.enum(['ENFORCE', 'MONITOR']).optional().describe('Omitted defaults to ENFORCE on the API.'),
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
    recordsAffected: z.number().int().min(0).max(100_000_000).optional(),
    containsSensitiveData: z.boolean().optional(),
  })
  .strict();

export const policyTestCaseSchema = z
  .object({
    name: z.string().min(1).max(200),
    input: policyTestInputSchema,
    expect: z
      .object({
        decision: decisionSchema,
        policy: z.string().min(1).max(120).optional().describe('Expected matched policy name.'),
      })
      .strict()
      .optional(),
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
    recordsAffected: z.number().int().min(0).max(100_000_000).optional(),
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
    destination: eventDestinationSchema.optional(),
    recordsAffected: z.number().int().min(0).max(100_000_000).optional(),
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
    cases: z.array(policyTestCaseSchema).min(1).max(200),
  })
  .strict();

export const planPolicyChangesInput = z
  .object({
    policies: z.array(policySpecSchema),
    prune: z.boolean().optional().describe('When true, the plan marks stored policies whose names are missing from policies for deletion. Nothing is deleted.'),
  })
  .strict();

export const checkMcpToolCallInput = z
  .object({
    tool: z.string().min(1).max(200).describe('Downstream MCP tool name. Vulnify maps it to an action by substring. The tool is not executed.'),
    arguments: z.record(z.string(), z.unknown()).optional().describe('Tool arguments. Not executed by Vulnify.'),
    agent: z.string().min(1).max(100).optional(),
    agentId: z.string().uuid().optional(),
    resource: z.string().min(1).max(100).optional(),
    resourceId: z.string().uuid().optional(),
    destination: eventDestinationSchema.optional(),
    recordsAffected: z.number().int().min(0).max(100_000_000).optional(),
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
