# Receipts

Every tool call that passes through the gateway produces a signed receipt. Receipts form an append-only audit trail stored at `apps/server/receipts/ledger.jsonl`.

## Schema (v0.1)

```json
{
  "receipt_version": "0.1",
  "receipt_id": "clx7abc123def",
  "timestamp": "2026-03-15T12:00:00.000Z",
  "session": {
    "sessionId": "sess_01",
    "agentId": "my-agent",
    "userId": "user-123",
    "environment": "production"
  },
  "request": {
    "tool_name": "gmail.send",
    "capability": "EMAIL_SEND",
    "risk": {
      "level": "low",
      "reasons": []
    },
    "intent": "Send Q1 review to team",
    "args_hash": "sha256:ab3f...",
    "redacted_args": {
      "to": ["alice@mycompany.com"],
      "subject": "Q1 Review",
      "body_hash": "sha256:9e1d..."
    }
  },
  "policy": {
    "policy_id": "default-v1",
    "decision": "allow",
    "matched_rules": ["allow_internal_email"],
    "explanation": "Internal recipients only"
  },
  "approval": null,
  "execution": {
    "status": "success",
    "attempts": 1,
    "idempotency_key": "sha256:7f2c...",
    "result_hash": "sha256:d4e5...",
    "latency_ms": 342
  },
  "verification": {
    "method": "read_after_write",
    "status": "verified",
    "after_snapshot": { "messageId": "msg_18a3", "isDraft": false },
    "diff_summary": "Created gmail.send artifact msg_18a3"
  },
  "redaction": {
    "fields_redacted": ["body"]
  },
  "signature": {
    "alg": "ed25519",
    "public_key_id": "base64-encoded-public-key",
    "signature_b64": "base64-encoded-ed25519-signature"
  }
}
```

### Field Reference

| Field                   | Type   | Description                                                                                                        |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `receipt_version`       | string | Always `"0.1"` for this version.                                                                                   |
| `receipt_id`            | string | Unique receipt identifier (CUID).                                                                                  |
| `timestamp`             | string | ISO 8601 timestamp of when the receipt was created.                                                                |
| `session`               | object | Contains `sessionId`, `agentId`, optional `userId` and `environment`.                                              |
| `request.tool_name`     | string | Raw tool name as invoked by the agent (e.g. `gmail.send`).                                                         |
| `request.capability`    | string | Classified capability (e.g. `EMAIL_SEND`, `CALENDAR_WRITE`).                                                       |
| `request.risk`          | object | Risk assessment: `level` (`low`/`medium`/`high`) and `reasons` array.                                              |
| `request.intent`        | string | Optional human-readable intent provided by the agent.                                                              |
| `request.args_hash`     | string | SHA-256 hash of the canonicalized call arguments.                                                                  |
| `request.redacted_args` | object | Safe metadata from the call arguments. Sensitive fields are replaced with `<field>_hash`.                          |
| `policy`                | object | Policy evaluation result: `policy_id`, `decision`, `matched_rules`, `explanation`.                                 |
| `approval`              | object | Present when approval was required. Contains `status` (`approved`/`denied`), `actor`, `comment`, `timestamp`.      |
| `execution`             | object | Present when the call was executed. Contains `status`, `attempts`, `idempotency_key`, `result_hash`, `latency_ms`. |
| `verification`          | object | Present for Tier-1 actions. Contains `method`, `status`, `after_snapshot`, `diff_summary`.                         |
| `redaction`             | object | Lists which argument fields were redacted: `fields_redacted` array.                                                |
| `signature`             | object | Ed25519 signature: `alg`, `public_key_id`, `signature_b64`.                                                        |

## Signing

Receipts are signed to make tampering detectable. The signing process is:

1. **Canonicalize.** Build the receipt object without the `signature` field. Pass it through `stableStringify` -- a deterministic JSON serializer that sorts keys and removes undefined values.
2. **Sign.** Compute an ed25519 signature over the canonical byte string using the server's private key.
3. **Encode.** Base64-encode the signature and set it as `signature.signature_b64` on the receipt.

```
canonical = stableStringify(receipt without signature)
signature = ed25519.sign(canonical, privateKey)
receipt.signature = { alg: 'ed25519', public_key_id: base64(publicKey), signature_b64: base64(signature) }
```

The server's ed25519 key pair is generated on first boot and stored in the server's data directory. Set `SIGNING_PUBLIC_KEY` and `SIGNING_PRIVATE_KEY` environment variables for persistent keys across restarts.

## Verification

Verify a receipt by calling:

```
GET /receipts/:id/verify
```

Response:

```json
{
  "valid": true
}
```

The endpoint reads the receipt from the append-only JSONL ledger, re-canonicalizes it, and checks the signature against the server's public key. It returns `valid: false` if the receipt has been modified or the signature does not match.

## Redaction Policy

Receipts never store sensitive content in cleartext. The redaction policy controls what is kept:

- **Redacted fields**: `body`, `description`, `content`, `message` — replaced with `<field>_hash` (SHA-256). The original text is not recoverable from the ledger.
- **Safe metadata**: `to`, `from`, `cc`, `bcc`, `subject`, `title`, `startTime`, `endTime`, `attendees`, `isDraft` — stored as-is.
- **Short strings**: Any other string field under 200 characters is kept. Longer strings are hashed.
- **Numbers and booleans**: Always kept.

The `redaction.fields_redacted` array in each receipt lists which fields were redacted, enabling consumers to know what was hashed.

## Ledger Storage

Receipts are stored as newline-delimited JSON (JSONL) at:

```
apps/server/receipts/ledger.jsonl
```

Each line is one complete receipt object including its signature. The file is append-only; lines are never modified or removed. On server startup the ledger file is created if it does not exist.

To read the ledger programmatically, stream the file line by line and parse each line as JSON.
