use serde_json::{Value, json};

pub const NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION: &str = "native_session_bootstrap_v5";
pub const BOOTSTRAP_FORMATTER_VERSION: i64 = 5;
pub const SESSION_CHARTER_REVISION: i64 = 13;
pub const CODEX_SESSION_GUIDANCE_REVISION: i64 = 1;
pub const AGENT_RUN_CONTEXT_FORMATTER_VERSION: i64 = 27;
pub const CONTEXT_MANIFEST_VERSION: i64 = 27;
pub const PUBLIC_CAMP_BATCH_CONTEXT_FORMATTER_VERSION: i64 = 30;
pub const PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION: i64 = 30;

pub(crate) fn native_binding_context_contract() -> Value {
    json!({
        "nativeSessionBootstrap": NATIVE_SESSION_BOOTSTRAP_CONTRACT_VERSION,
        "bootstrapFormatterVersion": BOOTSTRAP_FORMATTER_VERSION,
        "sessionCharterRevision": SESSION_CHARTER_REVISION,
        "agentRunContextFormatterVersion": AGENT_RUN_CONTEXT_FORMATTER_VERSION,
        "contextManifestVersion": CONTEXT_MANIFEST_VERSION,
    })
}

/// v1.69 only adds Skill discovery text. Keep the exact v1.68 context axes in
/// Native Binding identity so an otherwise compatible old Session survives.
/// Bootstrap evidence itself still records v5 for every newly created Binding.
pub(crate) fn native_binding_compatibility_context_contract() -> Value {
    json!({
        "nativeSessionBootstrap": "native_session_bootstrap_v4",
        "bootstrapFormatterVersion": 4,
        "sessionCharterRevision": SESSION_CHARTER_REVISION,
        "agentRunContextFormatterVersion": 26,
        "contextManifestVersion": 26,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../packages/contracts/fixtures/agent-run-context-v26.json"
        ))
        .expect("shared AgentRun context fixture must be valid JSON")
    }

    #[test]
    fn binding_contract_freezes_each_context_axis_version() {
        let fixture = shared_fixture();
        let legacy = json!({
            "nativeSessionBootstrap": fixture["nativeSessionBootstrap"],
            "bootstrapFormatterVersion": fixture["bootstrapFormatterVersion"],
            "sessionCharterRevision": 4,
            "agentRunContextFormatterVersion": fixture["agentRunContextFormatterVersion"],
            "contextManifestVersion": fixture["contextManifestVersion"],
        });
        let current = native_binding_context_contract();
        assert_eq!(current["sessionCharterRevision"], 13);
        assert_eq!(PUBLIC_CAMP_BATCH_CONTEXT_FORMATTER_VERSION, 30);
        assert_eq!(PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION, 30);
        assert_eq!(
            current,
            json!({
                "nativeSessionBootstrap": "native_session_bootstrap_v5",
                "bootstrapFormatterVersion": 5,
                "sessionCharterRevision": SESSION_CHARTER_REVISION,
                "agentRunContextFormatterVersion": 27,
                "contextManifestVersion": 27,
            })
        );
        let mut unversioned_charter = legacy.clone();
        unversioned_charter
            .as_object_mut()
            .unwrap()
            .remove("sessionCharterRevision");
        for old_contract in [legacy, unversioned_charter] {
            assert_ne!(
                crate::command::canonical_json_digest(&current).unwrap(),
                crate::command::canonical_json_digest(&old_contract).unwrap(),
                "Session Charter revision must rotate every Adapter Binding compatibility digest"
            );
        }
    }
}
