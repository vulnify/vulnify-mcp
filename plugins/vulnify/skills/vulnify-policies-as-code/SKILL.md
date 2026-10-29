---
name: vulnify-policies-as-code
description: List, test, and plan Vulnify policies as code without writing them. Use when editing organization policies, checking a proposed policy against cases, or asking what an apply would change.
---

# Policies as code

Use the read-only policy tools. This server has no tool that writes policies.

## Tools

- `list_policies` reads the stored policies (`GET /v1/policies`). Any non-revoked key may call it.
- `test_policies` evaluates up to 200 cases (`POST /v1/policies/test`). Omit `policies` to test the stored set. Pass `policies` to test a proposal. Nothing is written. Cases do not scan content.
- `plan_policy_changes` posts to `POST /v1/policies/apply` with `dryRun` forced on. You cannot turn `dryRun` off. The response is a plan of creates, updates, deletes, and unchanged names. Nothing is stored.
- `check_action` is one stored-policy dry run. Prefer `test_policies` when you have more than one case.

`plan_policy_changes` needs an org-wide LIVE API key. A TEST key or an agent-bound key returns 403. Say that to the user instead of retrying.

## Shapes that are easy to mix up

- A policy `action` is a family: `ANY`, `READ`, `WRITE`, `DELETE`, `EXPORT`.
- A case `input.action` is an event action: `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA`, `SEND_EMAIL`.
- A policy `resource` is a classification such as `CUSTOMER_PII`, or null. A case `input.resource` is the resource name registered in the organization.
- A condition `destination` is `EXTERNAL` or `INTERNAL`. An event `destination` is `INTERNAL`, `EXTERNAL_EMAIL`, or `EXTERNAL_API`.
- `minRecords` means `recordsAffected` is at least that number. More than 1000 records is `minRecords: 1001`.

`prune: true` only marks missing names for deletion inside the plan. It does not delete them.

Policy list, test, and plan calls share a limit of 60 requests per minute per key.
