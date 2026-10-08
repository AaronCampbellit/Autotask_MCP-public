# Company selection and optional MRTR

`at_select_company` searches the current authorized Companies query surface using a server-owned `companyName contains query` filter. Tool arguments accept only the query and an optional exact selected company ID. Clients cannot submit candidate lists or authorize records through labels.

The ordinary fallback returns at most 20 ID/name candidates. If the native page is incomplete, the result explicitly asks for a narrower query; a single displayed result is not treated as a unique match. An explicit selection reruns the matching query and reads the selected native company under fresh permissions. Changed names, mismatched IDs, revoked scope and missing records fail closed.

MRTR is opt-in and requires both the modern protocol and advertised form elicitation support. With a complete ambiguous list, the helper returns the SDK `inputRequired` result directly (`resultType: input_required`), not a normal text wrapper. Its opaque encrypted state binds actor, tenant, operation, query fingerprint, mapping/policy versions, candidate IDs and five-minute expiry. A durable nonce is consumed once. Continuation acceptance rechecks the current company match and native record before returning selection; decline/cancel consumes the handle without a provider record action.

This is selection only: no mutation or write approval is authorized. It is a supporting tool and must not be wrapped through generic dispatchers that would discard its SDK result marker. Host opt-in should remain off until the target client's actual MRTR behavior has been verified; unsupported hosts receive the ordinary result.

Local tests cover server-controlled candidates, ordinary fallback, host gates, native revalidation, stale query/name/scope rejection, replay, partial results and cancellation. Actual ChatGPT/Codex host acceptance remains a separate release gate.
