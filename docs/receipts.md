# Receipts

Every tool call that passes through the gateway produces a signed receipt. Receipts form an append-only audit trail stored at `apps/server/receipts/ledger.jsonl`.

## Schema (v0.1)

```json
{
  "schema_version": "0.1",
  "receipt_id": "rec_01JQ3K...",
  "timestamp": "2026-02-16T12:00:00.000Z",
  "agent_id": "agent_default",
  "tool": "gmail.send",
  "capability": "email:send",
  "args_hash": "sha256:ab3f…",
  "decision": "allow",
  "decision_reason": "Internal recipient",
  "policy_id": "org-email-policy",
  "rule_id": "allow-internal",
  "idempotency_key": "idem_7f2c…",
  "execution": {
    "status": "success",
    "duration_ms": 342,
    "retries": 0,
    "connector": "gmail",
    "external_id": "msg_18a3…"
  },
  "verification": {
    "type": "read-after-write",
    "passed": true,
    "checked_at": "2026-02-16T12:00:01.000Z"
  },
  "description": "Sent email to alice@acme.com",
  "body_hash": "sha256:9e1d…",
  "signature": "base64-encoded-ed25519-signature"
}
```

### Field Reference

| Field             | Type   | Description                                                                                                                  |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`  | string | Always `"0.1"` for this version.                                                                                             |
| `receipt_id`      | string | Unique receipt identifier.                                                                                                   |
| `timestamp`       | string | ISO 8601 timestamp of when the receipt was created.                                                                          |
| `agent_id`        | string | Identifier of the agent that made the call.                                                                                  |
| `tool`            | string | Raw tool name as invoked by the agent.                                                                                       |
| `capability`      | string | Classified capability (e.g. `email:send`).                                                                                   |
| `args_hash`       | string | SHA-256 hash of the canonicalized call arguments.                                                                            |
| `decision`        | string | Policy decision: `allow`, `deny`, or `require_approval`.                                                                     |
| `decision_reason` | string | Human-readable reason from the matched rule.                                                                                 |
| `policy_id`       | string | ID of the policy that was evaluated.                                                                                         |
| `rule_id`         | string | ID of the rule that matched, or `"default"` if none matched.                                                                 |
| `idempotency_key` | string | Key used to deduplicate retries.                                                                                             |
| `execution`       | object | Present only if the call was executed. Contains `status`, `duration_ms`, `retries`, `connector`, and optional `external_id`. |
| `verification`    | object | Present only for Tier-1 actions. Contains `type`, `passed`, and `checked_at`.                                                |
| `description`     | string | Short human-readable summary of the action. May be redacted.                                                                 |
| `body_hash`       | string | SHA-256 hash of the full request body. Used when the body is redacted.                                                       |
| `signature`       | string | Base64-encoded ed25519 signature over the canonicalized receipt.                                                             |

## Signing

Receipts are signed to make tampering detectable. The signing process is:

1. **Canonicalize.** Build the receipt object without the `signature` field. Pass it through `stableStringify` -- a deterministic JSON serializer that sorts keys and removes undefined values.
2. **Sign.** Compute an ed25519 signature over the canonical byte string using the server's private key.
3. **Encode.** Base64-encode the signature and set it as the `signature` field on the receipt.

```
canonical = stableStringify(receipt without signature)
signature = ed25519.sign(canonical, privateKey)
receipt.signature = base64(signature)
```

The server's ed25519 key pair is generated on first boot and stored in the server's data directory.

## Verification

Verify a receipt by calling:

```
GET /receipts/:id/verify
```

Response:

```json
{
  "valid": true,
  "receipt_id": "rec_01JQ3K...",
  "verified_at": "2026-02-16T12:05:00.000Z"
}
```

The endpoint re-canonicalizes the stored receipt and checks the signature against the server's public key. It returns `valid: false` if the receipt has been modified or the signature does not match.

## Redaction Policy

Receipts may contain sensitive data in `description` and the original call arguments. The redaction policy controls what is stored in the ledger:

- **Body**: The full request body is never stored in the receipt. Only `body_hash` (a SHA-256 hash) is kept, allowing verification that a body matches without exposing its content.
- **Description**: For sensitive capabilities (e.g. `email:send`), the description is hashed before storage. The original text is not recoverable from the ledger.
- **Safe metadata**: Fields like `receipt_id`, `timestamp`, `tool`, `capability`, `decision`, `policy_id`, `rule_id`, and `execution.status` are always stored in cleartext. These are considered safe for audit purposes.

## Ledger Storage

Receipts are stored as newline-delimited JSON (JSONL) at:

```
apps/server/receipts/ledger.jsonl
```

Each line is one complete receipt object including its signature. The file is append-only; lines are never modified or removed. On server startup the ledger file is created if it does not exist.

To read the ledger programmatically, stream the file line by line and parse each line as JSON.
