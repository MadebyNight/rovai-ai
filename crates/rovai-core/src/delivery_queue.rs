use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{
    agent_profile::{FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    camp_content::StructuredCampMessageContent,
    collaboration::build_effective_config,
    current_input_skill::freeze_skill_selection,
    db::Database,
    runtime::AgentRunWorkspace,
};

pub const DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES: usize = 96 * 1024;
const BATCH_FIXED_CONTEXT_RESERVE_BYTES: usize = 24 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnqueuedDelivery {
    pub delivery_id: String,
    pub recipient_agent_id: String,
}

#[derive(Debug, Clone)]
struct WaitingDelivery {
    id: String,
    message_id: String,
    sequence: i64,
    author_type: String,
    author_id: String,
    body: String,
    structured_content_json: Option<String>,
    anchor_message_id: Option<String>,
    content_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchSizingMessage<'a> {
    message_id: &'a str,
    sequence: i64,
    sender_type: &'a str,
    sender_id: &'a str,
    body: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    structured_content_json: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    anchor_message_id: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct BatchSizingInput<'a> {
    messages: Vec<BatchSizingMessage<'a>>,
}

pub(crate) fn enqueue_message_deliveries(
    transaction: &Transaction<'_>,
    camp_id: &str,
    message_id: &str,
    message_sequence: i64,
    recipient_agent_ids: &[String],
    now: &str,
) -> Result<Vec<EnqueuedDelivery>> {
    let mut deliveries = Vec::with_capacity(recipient_agent_ids.len());
    for recipient_agent_id in recipient_agent_ids {
        let membership_version = transaction
            .query_row(
                r#"
                SELECT version
                FROM camp_member
                WHERE camp_id = ?1 AND agent_id = ?2
                  AND status = 'active' AND leave_requested_at IS NULL
                "#,
                params![camp_id, recipient_agent_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .with_context(|| {
                format!("Message Delivery target {recipient_agent_id} is not an active Camp member")
            })?;
        let delivery_id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO camp_message_delivery(
                id, camp_id, message_id, recipient_agent_id,
                recipient_membership_version_at_admission, queue_sequence,
                status, claimed_agent_run_id, failure_code, version,
                created_at, claimed_at, ended_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'waiting', NULL, NULL, 1,
                      ?7, NULL, NULL, ?7)
            "#,
            params![
                delivery_id,
                camp_id,
                message_id,
                recipient_agent_id,
                membership_version,
                message_sequence,
                now,
            ],
        )?;
        deliveries.push(EnqueuedDelivery {
            delivery_id,
            recipient_agent_id: recipient_agent_id.clone(),
        });
    }
    Ok(deliveries)
}

/// Converts waiting Delivery lanes into immutable, ordered multi-input AgentRuns.
/// Waiting rows carry only message responsibility. Runtime, model, permissions and
/// workspace are resolved here and frozen on the newly created Run.
pub fn claim_waiting_delivery_batches(database: &mut Database, limit: i64) -> Result<Vec<String>> {
    if !(1..=100).contains(&limit) {
        anyhow::bail!("Delivery claim limit must be between 1 and 100");
    }
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let lanes = {
        let mut statement = transaction.prepare(
            r#"
            SELECT delivery.camp_id, delivery.recipient_agent_id,
                   conversation.id, MIN(delivery.queue_sequence)
            FROM camp_message_delivery AS delivery
            JOIN conversation
              ON conversation.camp_id = delivery.camp_id
             AND conversation.agent_id = delivery.recipient_agent_id
             AND conversation.kind = 'camp_member'
            JOIN camp_member
              ON camp_member.camp_id = delivery.camp_id
             AND camp_member.agent_id = delivery.recipient_agent_id
            JOIN agent_profile ON agent_profile.id = delivery.recipient_agent_id
            WHERE delivery.status = 'waiting'
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run AS active
                  WHERE active.conversation_id = conversation.id
                    AND active.status IN ('queued', 'running', 'waiting')
              )
            GROUP BY delivery.camp_id, delivery.recipient_agent_id, conversation.id
            ORDER BY MIN(delivery.created_at), MIN(delivery.queue_sequence),
                     delivery.camp_id, delivery.recipient_agent_id
            LIMIT ?1
            "#,
        )?;
        statement
            .query_map([limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut claimed_run_ids = Vec::new();
    for (camp_id, agent_id, conversation_id) in lanes {
        let runtime = match resolve_frozen_runtime(&transaction, &conversation_id, &agent_id)? {
            Ok(runtime) => runtime,
            Err(_) => continue,
        };
        let effective_config =
            build_effective_config(&transaction, &conversation_id, &agent_id, &runtime)?;
        let project_path: String = transaction.query_row(
            "SELECT project_path FROM camp WHERE id = ?1",
            [&camp_id],
            |row| row.get(0),
        )?;
        let workspace = AgentRunWorkspace::runtime_managed_path(project_path);
        workspace.validate()?;
        let cleanup_pending_on_execution_root: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run AS prior_run
                LEFT JOIN camp_turn AS prior_turn
                  ON prior_turn.id = prior_run.camp_turn_id
                JOIN camp AS prior_camp
                  ON prior_camp.id = COALESCE(prior_run.camp_id, prior_turn.camp_id)
                WHERE prior_run.status IN ('succeeded', 'failed', 'cancelled')
                  AND prior_run.cancel_requested_at IS NOT NULL
                  AND prior_run.cancel_acknowledged_at IS NULL
                  AND COALESCE(
                      json_extract(prior_run.workspace_json, '$.executionRoot'),
                      prior_camp.project_path
                  ) = ?1
            )
            "#,
            [&workspace.execution_root],
            |row| row.get(0),
        )?;
        if cleanup_pending_on_execution_root {
            continue;
        }
        let camp_public_tail: i64 = transaction.query_row(
            "SELECT last_message_sequence FROM camp WHERE id = ?1",
            [&camp_id],
            |row| row.get(0),
        )?;
        let conversation_tail: i64 = transaction.query_row(
            "SELECT last_message_sequence FROM conversation WHERE id = ?1",
            [&conversation_id],
            |row| row.get(0),
        )?;
        let waiting = load_waiting_prefix(&transaction, &camp_id, &agent_id)?;
        if waiting.is_empty() {
            continue;
        }
        let (selected_count, first_too_large) = select_batch_prefix(&waiting)?;
        let selected = &waiting[..selected_count];
        let anchor_message_id = selected
            .last()
            .map(|delivery| delivery.message_id.as_str())
            .context("Delivery claim selected an empty input batch")?;
        let now = chrono::Utc::now().to_rfc3339();
        let agent_run_id = Uuid::new_v4().to_string();
        insert_batch_run(
            &transaction,
            &agent_run_id,
            &camp_id,
            &conversation_id,
            &agent_id,
            anchor_message_id,
            camp_public_tail,
            conversation_tail,
            &effective_config,
            &workspace,
            &runtime,
            selected,
            first_too_large,
            &now,
        )?;
        claimed_run_ids.push(agent_run_id);
    }
    transaction.commit()?;
    Ok(claimed_run_ids)
}

fn load_waiting_prefix(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<Vec<WaitingDelivery>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT delivery.id, message.id, message.sequence,
               message.author_type, message.author_id, message.body,
               message.structured_content_json,
               message.reply_to_camp_message_id, message.content_digest
        FROM camp_message_delivery AS delivery
        JOIN camp_message AS message ON message.id = delivery.message_id
        WHERE delivery.camp_id = ?1
          AND delivery.recipient_agent_id = ?2
          AND delivery.status = 'waiting'
          AND message.tombstoned_at IS NULL
          AND message.recall_state <> 'withdrawn'
        ORDER BY delivery.queue_sequence
        "#,
    )?;
    Ok(statement
        .query_map(params![camp_id, agent_id], |row| {
            Ok(WaitingDelivery {
                id: row.get(0)?,
                message_id: row.get(1)?,
                sequence: row.get(2)?,
                author_type: row.get(3)?,
                author_id: row.get(4)?,
                body: row.get(5)?,
                structured_content_json: row.get(6)?,
                anchor_message_id: row.get(7)?,
                content_digest: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn select_batch_prefix(waiting: &[WaitingDelivery]) -> Result<(usize, bool)> {
    let available =
        DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES.saturating_sub(BATCH_FIXED_CONTEXT_RESERVE_BYTES);
    for count in 1..=waiting.len() {
        let payload = BatchSizingInput {
            messages: waiting[..count]
                .iter()
                .map(|message| BatchSizingMessage {
                    message_id: &message.message_id,
                    sequence: message.sequence,
                    sender_type: &message.author_type,
                    sender_id: &message.author_id,
                    body: &message.body,
                    structured_content_json: message.structured_content_json.as_deref(),
                    anchor_message_id: message.anchor_message_id.as_deref(),
                })
                .collect(),
        };
        if serde_json::to_vec(&payload)?.len() > available {
            return Ok(if count == 1 {
                (1, true)
            } else {
                (count - 1, false)
            });
        }
    }
    Ok((waiting.len(), false))
}

#[allow(clippy::too_many_arguments)]
fn insert_batch_run(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    camp_id: &str,
    conversation_id: &str,
    agent_id: &str,
    anchor_message_id: &str,
    camp_public_tail: i64,
    conversation_tail: i64,
    effective_config: &Value,
    workspace: &AgentRunWorkspace,
    runtime: &FrozenAgentRuntimeConfig,
    selected: &[WaitingDelivery],
    first_too_large: bool,
    now: &str,
) -> Result<()> {
    let mut batch_content = Vec::new();
    for delivery in selected {
        let Some(content_json) = delivery.structured_content_json.as_deref() else {
            continue;
        };
        let mut content = serde_json::from_str::<StructuredCampMessageContent>(content_json)
            .context("CampMessage Structured Content is invalid during Delivery claim")?;
        batch_content.append(&mut content);
    }
    let skill_selection =
        freeze_skill_selection(transaction, &batch_content, runtime.adapter_kind)?;
    let (skill_selection_json, skill_selection_digest) =
        skill_selection.canonical_json_and_digest()?;
    let first_delivery_id = &selected[0].id;
    let last_delivery_id = &selected[selected.len() - 1].id;
    let status = if first_too_large { "failed" } else { "queued" };
    let ended_at = first_too_large.then_some(now);
    let error_code = first_too_large.then_some("context_payload_too_large");
    transaction.execute(
        r#"
        INSERT INTO agent_run(
            id, camp_turn_id, conversation_id, task_id,
            trigger_conversation_message_id, input_ready_at,
            initial_camp_context_through_sequence,
            initial_conversation_context_through_sequence,
            responsibility_key, responsibility_generation,
            predecessor_agent_run_id, start_reason, purpose, completion_role,
            effective_config_json, workspace_json,
            status, idempotency_key, last_error_code,
            execution_epoch, version, created_at, ended_at, updated_at,
            runtime_adapter_kind, runtime_installation_id,
            runtime_reported_version, runtime_executable_fingerprint,
            runtime_capabilities_json, runtime_model_selection_json,
            runtime_permission_config_json, runtime_binding_compatibility_digest,
            runtime_executable_path, runtime_auth_scope,
            runtime_host_config_digest, runtime_protocol_version,
            runtime_installation_generation, runtime_search_environment_generation,
            runtime_native_session_compatibility_key,
            runtime_initial_reported_version, runtime_initial_executable_fingerprint,
            invocation_kind, permission_semantics,
            skill_selection_snapshot_json, skill_selection_snapshot_digest,
            camp_id, anchor_message_id, current_public_tail_sequence
        ) VALUES (
            ?1, NULL, ?2, NULL,
            NULL, ?3, ?4, ?5,
            ?6, 0, NULL, 'initial', ?7, 'required',
            ?8, ?9,
            ?10, ?11, ?12,
            0, 1, ?3, ?13, ?3,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
            ?26, ?27, ?28, ?16, ?17,
            'batch', 'runtime_managed_v2', ?29, ?30,
            ?31, ?32, ?4
        )
        "#,
        params![
            agent_run_id,
            conversation_id,
            now,
            camp_public_tail,
            conversation_tail,
            format!("batch/{agent_id}/{first_delivery_id}/{last_delivery_id}"),
            "Handle the claimed Camp message batch",
            serde_json::to_string(effective_config)?,
            serde_json::to_string(workspace)?,
            status,
            format!("delivery-batch:{first_delivery_id}:{last_delivery_id}"),
            error_code,
            ended_at,
            runtime.adapter_kind.as_str(),
            runtime.installation_id,
            runtime.reported_version,
            runtime.executable_fingerprint,
            serde_json::to_string(&runtime.capabilities)?,
            serde_json::to_string(&runtime.model)?,
            serde_json::to_string(&runtime.permissions)?,
            runtime.binding_compatibility_digest,
            runtime.executable_path,
            runtime.auth_scope,
            runtime.host_config_digest,
            runtime.protocol_version,
            runtime.installation_generation,
            runtime.search_environment_generation,
            runtime.native_session_compatibility_key,
            skill_selection_json,
            skill_selection_digest,
            camp_id,
            anchor_message_id,
        ],
    )?;
    for (ordinal, delivery) in selected.iter().enumerate() {
        transaction.execute(
            r#"
            INSERT INTO agent_run_input(
                agent_run_id, ordinal, delivery_id, message_id,
                message_sequence, message_content_digest
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                agent_run_id,
                i64::try_from(ordinal).context("AgentRun input ordinal overflow")?,
                delivery.id,
                delivery.message_id,
                delivery.sequence,
                delivery.content_digest,
            ],
        )?;
        let terminal_status = if first_too_large { "failed" } else { "claimed" };
        transaction.execute(
            r#"
            UPDATE camp_message_delivery
            SET status = ?2, claimed_agent_run_id = ?3, claimed_at = ?4,
                failure_code = ?5, ended_at = ?6,
                version = version + 1, updated_at = ?4
            WHERE id = ?1 AND status = 'waiting'
            "#,
            params![
                delivery.id,
                terminal_status,
                agent_run_id,
                now,
                error_code,
                ended_at,
            ],
        )?;
        transaction.execute(
            r#"
            UPDATE camp_message
            SET recall_state = 'closed', version = version + 1, updated_at = ?2
            WHERE id = ?1 AND recall_state = 'recallable'
            "#,
            params![delivery.message_id, now],
        )?;
    }
    Ok(())
}

pub(crate) fn settle_run_deliveries(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    run_status: &str,
    failure_code: Option<&str>,
    now: &str,
) -> Result<usize> {
    let delivery_status = match run_status {
        "succeeded" => "settled",
        "cancelled" => "cancelled",
        "failed" => "failed",
        _ => return Ok(0),
    };
    Ok(transaction.execute(
        r#"
        UPDATE camp_message_delivery
        SET status = ?2, failure_code = ?3, ended_at = ?4,
            version = version + 1, updated_at = ?4
        WHERE claimed_agent_run_id = ?1 AND status = 'claimed'
        "#,
        params![agent_run_id, delivery_status, failure_code, now],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        camp_content::{StructuredCampMessageSegment, canonical_content_digest},
        collaboration::{CollaborationService, CreateCampCommand},
        command::{ActorRef, CommandEnvelope},
        current_input_skill::parse_skill_selection_snapshot,
    };

    struct Fixture {
        database: Database,
        _directory: std::path::PathBuf,
        camp_id: String,
    }

    impl Fixture {
        fn new() -> Self {
            let (mut database, directory) = crate::test_support::seeded_runtime_database_fast();
            let workspace = directory.join("workspace");
            std::fs::create_dir_all(&workspace).unwrap();
            let created = CollaborationService::default()
                .create_camp(
                    &mut database,
                    &CommandEnvelope {
                        command_id: "create-delivery-queue-test-camp".to_string(),
                        actor: ActorRef::User {
                            user_id: "local_user".to_string(),
                        },
                        camp_id: None,
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().into_owned(),
                            &["agent_1"],
                            "agent_1",
                        ),
                    },
                )
                .unwrap();
            let camp_id = created.result.payload["campId"]
                .as_str()
                .unwrap()
                .to_string();
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO conversation(
                        id, camp_id, agent_id, last_message_sequence,
                        version, created_at, updated_at
                    ) VALUES (
                        'delivery-queue-agent-1', ?1, 'agent_1', 0,
                        1, datetime('now'), datetime('now')
                    )
                    "#,
                    [&camp_id],
                )
                .unwrap();
            Self {
                database,
                _directory: directory,
                camp_id,
            }
        }

        fn enqueue(&mut self, message_id: &str, body: &str) -> String {
            let transaction = self.database.connection_mut().transaction().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            transaction
                .execute(
                    r#"
                    UPDATE camp
                    SET last_message_sequence = last_message_sequence + 1,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1
                    "#,
                    params![self.camp_id, now],
                )
                .unwrap();
            let sequence: i64 = transaction
                .query_row(
                    "SELECT last_message_sequence FROM camp WHERE id = ?1",
                    [&self.camp_id],
                    |row| row.get(0),
                )
                .unwrap();
            transaction
                .execute(
                    r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence, author_type, author_id, body,
                        structured_content_json, content_digest,
                        address_mode, addressed_agent_ids_json,
                        effective_recipient_ids_json, recipient_presentation_json,
                        origin_kind, recall_state, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, 'user', 'local_user', ?4,
                        ?5, ?6, 'explicit', '["agent_1"]',
                        '["agent_1"]', '{}', 'local_composer', 'recallable',
                        1, ?7, ?7
                    )
                    "#,
                    params![
                        message_id,
                        self.camp_id,
                        sequence,
                        body,
                        serde_json::to_string(&vec![serde_json::json!({
                            "kind": "text",
                            "text": body,
                        })])
                        .unwrap(),
                        format!("sha256:{message_id}"),
                        now,
                    ],
                )
                .unwrap();
            let delivery = enqueue_message_deliveries(
                &transaction,
                &self.camp_id,
                message_id,
                sequence,
                &["agent_1".to_string()],
                &now,
            )
            .unwrap()
            .pop()
            .unwrap();
            transaction.commit().unwrap();
            delivery.delivery_id
        }

        fn batch_run_count(&self) -> i64 {
            self.database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'batch'",
                    [],
                    |row| row.get(0),
                )
                .unwrap()
        }
    }

    #[test]
    fn waiting_deliveries_create_no_run_until_fifo_batch_claim() {
        let mut fixture = Fixture::new();
        let first_delivery_id = fixture.enqueue("message-1", "第一条");
        let second_delivery_id = fixture.enqueue("message-2", "第二条");

        assert_eq!(fixture.batch_run_count(), 0);
        let waiting: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message_delivery WHERE status = 'waiting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(waiting, 2);

        let claimed = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(claimed.len(), 1);
        let run_id = &claimed[0];
        let run: (String, String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, anchor_message_id, camp_turn_id FROM agent_run WHERE id = ?1",
                [run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(run, ("queued".to_string(), "message-2".to_string(), None));
        let inputs = {
            let mut statement = fixture
                .database
                .connection()
                .prepare(
                    "SELECT message_id, delivery_id FROM agent_run_input WHERE agent_run_id = ?1 ORDER BY ordinal",
                )
                .unwrap();
            statement
                .query_map([run_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            inputs,
            vec![
                ("message-1".to_string(), first_delivery_id),
                ("message-2".to_string(), second_delivery_id),
            ]
        );
        let closed: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE recall_state = 'closed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(closed, 2);
    }

    #[test]
    fn active_run_keeps_later_delivery_waiting_until_the_lane_is_free() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "先处理");
        let first_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        fixture.enqueue("message-2", "后处理");

        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .is_empty()
        );
        let waiting_run: Option<String> = fixture
            .database
            .connection()
            .query_row(
                "SELECT claimed_agent_run_id FROM camp_message_delivery WHERE message_id = 'message-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(waiting_run.is_none());

        let now = chrono::Utc::now().to_rfc3339();
        let transaction = fixture.database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![first_run, now],
            )
            .unwrap();
        assert_eq!(
            settle_run_deliveries(&transaction, &first_run, "succeeded", None, &now).unwrap(),
            1
        );
        transaction.commit().unwrap();

        let next = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(next.len(), 1);
        let next_anchor: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT anchor_message_id FROM agent_run WHERE id = ?1",
                [&next[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next_anchor, "message-2");
    }

    #[test]
    fn failed_run_without_cleanup_ack_keeps_successor_delivery_waiting() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "先处理");
        let first_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        fixture.enqueue("message-2", "后处理");

        let now = chrono::Utc::now().to_rfc3339();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', ended_at = ?2, updated_at = ?2,
                    cancel_requested_at = ?2,
                    cancel_reason_code = 'runtime_terminal_unconfirmed'
                WHERE id = ?1
                "#,
                params![first_run, now],
            )
            .unwrap();

        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .is_empty()
        );
        let waiting_run: Option<String> = fixture
            .database
            .connection()
            .query_row(
                "SELECT claimed_agent_run_id FROM camp_message_delivery WHERE message_id = 'message-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(waiting_run.is_none());

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET cancel_acknowledged_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![first_run, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        let next = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(next.len(), 1);
        let next_anchor: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT anchor_message_id FROM agent_run WHERE id = ?1",
                [&next[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next_anchor, "message-2");
    }

    #[test]
    fn claim_freezes_deduplicated_skill_mentions_from_the_whole_batch() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "$review-code first");
        fixture.enqueue("message-2", "$review-code second");
        let content = vec![StructuredCampMessageSegment::SkillMention {
            skill_id: "missing-skill".to_string(),
            name_at_send: "review-code".to_string(),
        }];
        let content_json = serde_json::to_string(&content).unwrap();
        let digest = canonical_content_digest(&content).unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_message
                SET structured_content_json = ?1, content_digest = ?2
                WHERE id IN ('message-1', 'message-2')
                "#,
                params![content_json, digest],
            )
            .unwrap();

        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        let (snapshot_json, snapshot_digest): (String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT skill_selection_snapshot_json, skill_selection_snapshot_digest
                FROM agent_run WHERE id = ?1
                "#,
                [&run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let snapshot = parse_skill_selection_snapshot(&snapshot_json, &snapshot_digest).unwrap();
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].skill_id, "missing-skill");
        assert_eq!(snapshot.entries[0].name_at_send, "review-code");
    }
}
