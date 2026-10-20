//! ChatBot mode: member Runtime reuse, chat transcript, communication items and
//! outbound delivery state. A chat turn is an ordinary Camp execution inside the
//! member's materials folder, so the member's own Runtime, model and permissions
//! answer the chat instead of a separate chat model configuration.
use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use std::str::FromStr;

use crate::agent_profile::{AdapterKind, AdapterPermissionConfig};
use crate::agent_runtime_adapter::AgentRuntimeAdapterRegistry;
use crate::collaboration::{ChatBotTurnAdmissionInput, CollaborationService};
use crate::db::Database;

pub(crate) const CHAT_MODE: &str = "chat";
pub(crate) const WORK_MODE: &str = "work";
const MAX_APP_ID_BYTES: usize = 256;
const MAX_CHAT_ID_BYTES: usize = 512;
const MAX_BODY_BYTES: usize = 32 * 1024;
const MAX_OUTBOUND_BYTES: usize = 16 * 1024;
const MAX_QUESTION_BYTES: usize = 8 * 1024;
const OUTBOUND_LEASE_MILLIS: i64 = 30_000;
const ITEM_WAITING: &str = "waiting";
const ITEM_REPORTED: &str = "reported";
const ITEM_CLOSED: &str = "closed";
const ITEM_PAUSED: &str = "paused";
const OUTBOUND_PENDING: &str = "pending";
const OUTBOUND_SENT: &str = "sent";
const OUTBOUND_FAILED: &str = "failed";
const OUTBOUND_UNKNOWN: &str = "unknown";

fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

fn text(value: &str, label: &str, max: usize) -> Result<()> {
    let trimmed = value.trim();
    anyhow::ensure!(!trimmed.is_empty(), "{label} is required");
    anyhow::ensure!(value.len() <= max, "{label} exceeds {max} bytes");
    Ok(())
}

fn validate_identity(provider: &str, app_id: &str) -> Result<()> {
    anyhow::ensure!(
        provider == "feishu" || provider == "lark",
        "chat mode supports feishu or lark only"
    );
    text(app_id, "appId", MAX_APP_ID_BYTES)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatBotConfigView {
    pub provider: String,
    pub app_id: String,
    /// The member whose Runtime answers this Bot once chat mode is on.
    pub agent_id: Option<String>,
    /// Inverse of the member's chat switch; kept so older read models stay valid.
    pub owner_only: bool,
    pub mode: String,
    /// The member's materials folder; also the execution root of chat Threads.
    pub materials_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInboundCommand {
    pub provider: String,
    pub app_id: String,
    pub external_message_id: String,
    pub chat_id: String,
    pub conversation_kind: String,
    pub chat_name: Option<String>,
    pub author_external_id: String,
    pub author_name: String,
    pub author_is_owner: bool,
    pub body: String,
    pub quote_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInboundResult {
    pub mode: String,
    pub duplicate: bool,
    pub owner: bool,
}

/// One inbound Feishu message admitted as a chat turn. Identity is the Bot's
/// published app; the answering member and folder come from Core state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnSubmitCommand {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub conversation_kind: String,
    pub chat_name: Option<String>,
    pub author_name: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnSubmitResult {
    pub camp_id: String,
    pub camp_message_id: String,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnResultParams {
    pub provider: String,
    pub app_id: String,
    pub camp_message_id: String,
}

/// Pending and running are live; waiting needs a human in the App; every other
/// state is terminal. Text is only present once the turn succeeded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnResultView {
    pub status: String,
    pub text: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnAppendCommand {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub role: String,
    pub body: String,
    pub materials_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnView {
    pub role: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatItemCreateCommand {
    pub provider: String,
    pub app_id: String,
    pub requester_external_id: String,
    pub requester_name: String,
    pub destination_chat_id: String,
    pub destination_kind: String,
    pub target_external_id: String,
    pub target_name: String,
    pub target_is_owner: bool,
    pub question: String,
    pub ask_message_id: Option<String>,
    pub ask_chat_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatItemView {
    pub id: String,
    pub provider: String,
    pub app_id: String,
    pub requester_external_id: String,
    pub requester_name: String,
    pub destination_chat_id: String,
    pub destination_kind: String,
    pub target_external_id: String,
    pub target_name: String,
    pub target_is_owner: bool,
    pub question: String,
    pub ask_message_id: Option<String>,
    pub ask_chat_id: Option<String>,
    pub status: String,
    pub last_report_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatItemUpdateCommand {
    pub item_id: String,
    pub status: Option<String>,
    pub mark_reported: bool,
    #[serde(default)]
    pub ask_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOwnerTargetView {
    pub app_id: String,
    pub external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundEnqueueCommand {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub text: String,
    pub source: String,
    pub idempotency_key: String,
    #[serde(default)]
    pub uses_materials: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundView {
    pub id: String,
    pub chat_id: String,
    pub text: String,
    pub source: String,
    pub attempts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundEnqueueResult {
    pub outbound_id: String,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundSettleCommand {
    pub outbound_id: String,
    pub status: String,
    pub external_message_id: Option<String>,
    pub failure_code: Option<String>,
}

/// Additive migration 209. Every table is chat-only state and never feeds Camp.
pub(crate) fn migrate(database: &mut Database) -> Result<()> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS channel_chat_bot (
            provider TEXT NOT NULL CHECK(provider IN ('feishu', 'lark')),
            app_id TEXT NOT NULL,
            owner_only INTEGER NOT NULL DEFAULT 1 CHECK(owner_only IN (0, 1)),
            model_provider TEXT,
            model_name TEXT,
            model_base_url TEXT,
            materials_path TEXT,
            materials_status TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, app_id)
        );

        CREATE TABLE IF NOT EXISTS channel_chat_credential (
            provider TEXT NOT NULL CHECK(provider IN ('feishu', 'lark')),
            app_id TEXT NOT NULL,
            api_key TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, app_id)
        );

        CREATE TABLE IF NOT EXISTS channel_chat_message (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            conversation_kind TEXT NOT NULL,
            chat_name TEXT,
            author_external_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            author_is_owner INTEGER NOT NULL DEFAULT 0 CHECK(author_is_owner IN (0, 1)),
            body TEXT NOT NULL,
            quote_message_id TEXT,
            external_message_id TEXT NOT NULL,
            dedupe_key TEXT NOT NULL UNIQUE,
            received_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_message_chat_idx
            ON channel_chat_message(provider, app_id, chat_id, received_at);

        CREATE TABLE IF NOT EXISTS channel_chat_turn (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
            body TEXT NOT NULL,
            materials_only INTEGER NOT NULL DEFAULT 0 CHECK(materials_only IN (0, 1)),
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_turn_chat_idx
            ON channel_chat_turn(provider, app_id, chat_id, created_at);

        CREATE TABLE IF NOT EXISTS channel_chat_item (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            requester_external_id TEXT NOT NULL,
            requester_name TEXT NOT NULL,
            destination_chat_id TEXT NOT NULL,
            destination_kind TEXT NOT NULL,
            target_external_id TEXT NOT NULL,
            target_name TEXT NOT NULL,
            target_is_owner INTEGER NOT NULL DEFAULT 0 CHECK(target_is_owner IN (0, 1)),
            question TEXT NOT NULL,
            ask_message_id TEXT,
            ask_chat_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('waiting', 'reported', 'closed', 'paused')),
            last_report_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_item_target_idx
            ON channel_chat_item(provider, app_id, target_external_id, status);

        CREATE TABLE IF NOT EXISTS channel_chat_outbound (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            app_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            body TEXT NOT NULL,
            source TEXT NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            uses_materials INTEGER NOT NULL DEFAULT 0 CHECK(uses_materials IN (0, 1)),
            status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed', 'unknown')),
            attempts INTEGER NOT NULL DEFAULT 0,
            lease_owner TEXT,
            lease_expires_at INTEGER,
            external_message_id TEXT,
            failure_code TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS channel_chat_outbound_claim_idx
            ON channel_chat_outbound(provider, app_id, status, created_at);
        "#,
    )?;
    // Additive chat tables do not change any existing projection, so the
    // projection schema marker stays at 154.
    transaction.execute(
        "INSERT INTO schema_migration VALUES(209,datetime('now'))",
        [],
    )?;
    transaction.commit()?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatScopeParams {
    pub provider: String,
    pub app_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatContextParams {
    pub provider: String,
    pub app_id: String,
    pub chat_id: String,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWaitingItemsParams {
    pub provider: String,
    pub app_id: String,
    pub target_external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutboundClaimParams {
    pub provider: String,
    pub app_id: String,
    pub worker_id: String,
    pub limit: i64,
}

/// Best-effort chat configuration for read models; a missing row means work mode.
pub(crate) fn config_for_app(
    connection: &Connection,
    provider: &str,
    app_id: &str,
) -> Option<ChatBotConfigView> {
    load_config(connection, provider, app_id).ok()
}

pub struct ChannelChatService;

impl ChannelChatService {
    pub fn snapshot(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<ChatBotConfigView> {
        validate_identity(provider, app_id)?;
        load_config(database.connection(), provider, app_id)
    }

    /// Admits one chat turn as an ordinary Camp execution inside the member's
    /// materials folder. The Thread is created once per external chat and then
    /// reused, so a conversation keeps its Runtime session.
    pub fn submit_turn(
        &self,
        database: &mut Database,
        command: &ChatTurnSubmitCommand,
    ) -> Result<ChatTurnSubmitResult> {
        validate_identity(&command.provider, &command.app_id)?;
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        text(&command.body, "body", MAX_BODY_BYTES)?;
        let config = load_config(database.connection(), &command.provider, &command.app_id)?;
        anyhow::ensure!(
            config.mode == CHAT_MODE,
            "chat mode is not enabled for this Bot"
        );
        let agent_id = config
            .agent_id
            .clone()
            .context("the chat Bot has no published member")?;
        let materials_path = config
            .materials_path
            .clone()
            .context("the chat Bot member has no materials folder")?;
        std::fs::create_dir_all(&materials_path)
            .with_context(|| format!("failed to prepare chat materials at {materials_path}"))?;
        let adapter_kind: Option<String> = database
            .connection()
            .query_row(
                "SELECT selected_runtime_adapter_kind FROM agent_profile WHERE id = ?1",
                [&agent_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        let adapter_kind = AdapterKind::from_str(
            adapter_kind
                .as_deref()
                .context("the chat Bot member has no Runtime configuration")?,
        )?;
        // Unattended chat never inherits the member's interactive bypass profile.
        let permission_override_json = serde_json::to_string(&AdapterPermissionConfig {
            adapter_kind,
            schema_version: 1,
            values: AgentRuntimeAdapterRegistry::default().chat_permission_ceiling(adapter_kind),
        })?;
        let now = Utc::now().to_rfc3339();
        let command_id = format!("chat-turn-{}", Uuid::new_v4());
        let body = format!(
            "[{}·{}] {}",
            conversation_label(command),
            command.author_name.trim(),
            command.body.trim()
        );
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let camp_id = bound_camp(
            &transaction,
            &command.provider,
            &command.app_id,
            &command.chat_id,
            &agent_id,
            &materials_path,
        )?;
        let admission = CollaborationService::default().admit_chat_bot_turn(
            &transaction,
            ChatBotTurnAdmissionInput {
                agent_id: agent_id.clone(),
                camp_id,
                camp_title: camp_title(command),
                project_path: materials_path.clone(),
                body,
                permission_override_json,
                command_id: command_id.clone(),
                now: now.clone(),
            },
        )?;
        let admission = match admission {
            Ok(admission) => admission,
            Err(rejection) => anyhow::bail!("chat turn was rejected: {}", rejection.code),
        };
        transaction.execute(
            r#"
            INSERT INTO channel_chat_conversation(provider, app_id, chat_id, camp_id, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(provider, app_id, chat_id) DO UPDATE SET
                camp_id = excluded.camp_id,
                created_at = excluded.created_at
            "#,
            params![
                command.provider,
                command.app_id,
                command.chat_id,
                admission.camp_id,
                now_millis(),
            ],
        )?;
        transaction.execute(
            "UPDATE camp SET navigation_is_chat_bot = 1 WHERE id = ?1",
            [&admission.camp_id],
        )?;
        transaction.commit()?;
        Ok(ChatTurnSubmitResult {
            camp_id: admission.camp_id,
            camp_message_id: admission.camp_message_id,
            duplicate: false,
        })
    }

    /// Reads the authoritative state of one submitted chat turn.
    pub fn turn_result(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        camp_message_id: &str,
    ) -> Result<ChatTurnResultView> {
        validate_identity(provider, app_id)?;
        let connection = database.connection();
        let delivery = connection
            .query_row(
                r#"
                SELECT delivery.status, delivery.claimed_agent_run_id
                FROM camp_message_delivery AS delivery
                WHERE delivery.message_id = ?1
                ORDER BY delivery.created_at, delivery.id
                LIMIT 1
                "#,
                [camp_message_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        let Some((delivery_status, agent_run_id)) = delivery else {
            return Ok(ChatTurnResultView {
                status: "failed".to_string(),
                text: None,
                reason: Some("chat_turn_not_admitted".to_string()),
            });
        };
        let Some(agent_run_id) = agent_run_id else {
            return Ok(ChatTurnResultView {
                status: if delivery_status == "cancelled" {
                    "cancelled".to_string()
                } else {
                    "pending".to_string()
                },
                text: None,
                reason: None,
            });
        };
        let (run_status, wait_reason) = connection
            .query_row(
                "SELECT status, wait_reason FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .context("chat turn Run does not exist")?;
        let status = match run_status.as_str() {
            "queued" => "pending",
            "running" => "running",
            "succeeded" => "completed",
            "waiting" => "waiting",
            "failed" => "failed",
            "cancelled" => "cancelled",
            other => other,
        };
        if status != "completed" {
            return Ok(ChatTurnResultView {
                status: status.to_string(),
                text: None,
                reason: wait_reason,
            });
        }
        let text = agent_run_result_text(connection, &agent_run_id)?;
        let reason = if text.is_none() {
            Some("empty_result".to_string())
        } else {
            None
        };
        Ok(ChatTurnResultView {
            status: "completed".to_string(),
            text,
            reason,
        })
    }

    pub fn inbound(
        &self,
        database: &mut Database,
        command: &ChatInboundCommand,
    ) -> Result<ChatInboundResult> {
        validate_identity(&command.provider, &command.app_id)?;
        text(
            &command.external_message_id,
            "externalMessageId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        text(
            &command.author_external_id,
            "authorExternalId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(&command.body, "body", MAX_BODY_BYTES)?;
        let config = load_config(database.connection(), &command.provider, &command.app_id)?;
        let dedupe_key = format!(
            "{}\u{0}{}\u{0}{}",
            command.provider, command.app_id, command.external_message_id
        );
        let now = now_millis();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let inserted = transaction.execute(
            r#"
            INSERT INTO channel_chat_message(
                id, provider, app_id, chat_id, conversation_kind, chat_name,
                author_external_id, author_name, author_is_owner, body,
                quote_message_id, external_message_id, dedupe_key, received_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(dedupe_key) DO NOTHING
            "#,
            params![
                Uuid::new_v4().to_string(),
                command.provider,
                command.app_id,
                command.chat_id,
                command.conversation_kind,
                command.chat_name,
                command.author_external_id,
                command.author_name,
                i64::from(command.author_is_owner),
                command.body,
                command.quote_message_id,
                command.external_message_id,
                dedupe_key,
                now
            ],
        )?;
        let duplicate = inserted == 0;
        if !duplicate {
            transaction.execute(
                r#"
                INSERT INTO channel_chat_turn(
                    id, provider, app_id, chat_id, role, body, materials_only, created_at
                ) VALUES (?1, ?2, ?3, ?4, 'user', ?5, 0, ?6)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    command.provider,
                    command.app_id,
                    command.chat_id,
                    command.body,
                    now
                ],
            )?;
        }
        transaction.commit()?;
        Ok(ChatInboundResult {
            mode: config.mode,
            duplicate,
            owner: command.author_is_owner,
        })
    }

    pub fn append_turn(
        &self,
        database: &mut Database,
        command: &ChatTurnAppendCommand,
    ) -> Result<()> {
        validate_identity(&command.provider, &command.app_id)?;
        anyhow::ensure!(
            command.role == "user" || command.role == "assistant",
            "unsupported chat turn role"
        );
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        anyhow::ensure!(!command.body.trim().is_empty(), "turn body is required");
        anyhow::ensure!(
            command.body.len() <= MAX_BODY_BYTES,
            "turn body is too large"
        );
        database.connection().execute(
            r#"
            INSERT INTO channel_chat_turn(
                id, provider, app_id, chat_id, role, body, materials_only, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                Uuid::new_v4().to_string(),
                command.provider,
                command.app_id,
                command.chat_id,
                command.role,
                command.body,
                i64::from(command.materials_only),
                now_millis()
            ],
        )?;
        Ok(())
    }

    pub fn context(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        chat_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatTurnView>> {
        validate_identity(provider, app_id)?;
        let limit = limit.clamp(1, 40);
        let mut statement = database.connection().prepare(
            r#"
            SELECT role, body FROM (
                SELECT role, body, created_at, rowid FROM channel_chat_turn
                WHERE provider = ?1 AND app_id = ?2 AND chat_id = ?3 AND materials_only = 0
                ORDER BY created_at DESC, rowid DESC LIMIT ?4
            ) ORDER BY created_at ASC, rowid ASC
            "#,
        )?;
        let rows = statement.query_map(params![provider, app_id, chat_id, limit], |row| {
            Ok(ChatTurnView {
                role: row.get(0)?,
                body: row.get(1)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn create_item(
        &self,
        database: &mut Database,
        command: &ChatItemCreateCommand,
    ) -> Result<ChatItemView> {
        validate_identity(&command.provider, &command.app_id)?;
        text(
            &command.requester_external_id,
            "requesterExternalId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(
            &command.destination_chat_id,
            "destinationChatId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(
            &command.target_external_id,
            "targetExternalId",
            MAX_CHAT_ID_BYTES,
        )?;
        text(&command.question, "question", MAX_QUESTION_BYTES)?;
        let now = now_millis();
        let id = Uuid::new_v4().to_string();
        database.connection().execute(
            r#"
            INSERT INTO channel_chat_item(
                id, provider, app_id, requester_external_id, requester_name,
                destination_chat_id, destination_kind, target_external_id,
                target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                status, last_report_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, ?15)
            "#,
            params![
                id,
                command.provider,
                command.app_id,
                command.requester_external_id,
                command.requester_name,
                command.destination_chat_id,
                command.destination_kind,
                command.target_external_id,
                command.target_name,
                i64::from(command.target_is_owner),
                command.question,
                command.ask_message_id,
                command.ask_chat_id,
                ITEM_WAITING,
                now
            ],
        )?;
        self.item(database, &id)?
            .context("chat item disappeared after insert")
    }

    pub fn item(&self, database: &mut Database, item_id: &str) -> Result<Option<ChatItemView>> {
        database
            .connection()
            .query_row(
                r#"
                SELECT id, provider, app_id, requester_external_id, requester_name,
                       destination_chat_id, destination_kind, target_external_id,
                       target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                       status, last_report_at, created_at
                FROM channel_chat_item WHERE id = ?1
                "#,
                [item_id],
                item_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn waiting_items_for_target(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        target_external_id: &str,
    ) -> Result<Vec<ChatItemView>> {
        validate_identity(provider, app_id)?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, provider, app_id, requester_external_id, requester_name,
                   destination_chat_id, destination_kind, target_external_id,
                   target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                   status, last_report_at, created_at
            FROM channel_chat_item
            WHERE provider = ?1 AND app_id = ?2 AND target_external_id = ?3 AND status = ?4
            ORDER BY created_at ASC
            "#,
        )?;
        let rows = statement.query_map(
            params![provider, app_id, target_external_id, ITEM_WAITING],
            item_row,
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn active_items(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<Vec<ChatItemView>> {
        validate_identity(provider, app_id)?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, provider, app_id, requester_external_id, requester_name,
                   destination_chat_id, destination_kind, target_external_id,
                   target_name, target_is_owner, question, ask_message_id, ask_chat_id,
                   status, last_report_at, created_at
            FROM channel_chat_item
            WHERE provider = ?1 AND app_id = ?2 AND status = ?3
            ORDER BY created_at ASC LIMIT 50
            "#,
        )?;
        let rows = statement.query_map(params![provider, app_id, ITEM_WAITING], item_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn update_item(
        &self,
        database: &mut Database,
        command: &ChatItemUpdateCommand,
    ) -> Result<ChatItemView> {
        let now = now_millis();
        let existing = self
            .item(database, &command.item_id)?
            .context("chat item not found")?;
        let status = command
            .status
            .as_deref()
            .unwrap_or(existing.status.as_str());
        anyhow::ensure!(
            matches!(
                status,
                ITEM_WAITING | ITEM_REPORTED | ITEM_CLOSED | ITEM_PAUSED
            ),
            "unsupported chat item status"
        );
        database.connection().execute(
            r#"
            UPDATE channel_chat_item
            SET status = ?2,
                last_report_at = CASE WHEN ?3 = 1 THEN ?4 ELSE last_report_at END,
                ask_message_id = COALESCE(?5, ask_message_id),
                updated_at = ?4
            WHERE id = ?1
            "#,
            params![
                command.item_id,
                status,
                i64::from(command.mark_reported),
                now,
                command.ask_message_id
            ],
        )?;
        self.item(database, &command.item_id)?
            .context("chat item disappeared after update")
    }

    pub fn owner_target(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<Option<ChatOwnerTargetView>> {
        validate_identity(provider, app_id)?;
        let (bot, owner, app) = match provider {
            "feishu" => (
                "feishu_member_bot",
                "feishu_owner_identity",
                "feishu_owner_app_identity",
            ),
            _ => (
                "lark_member_bot",
                "lark_owner_identity",
                "lark_owner_app_identity",
            ),
        };
        database
            .connection()
            .query_row(
                &format!(
                    r#"
                    SELECT bot.app_id, identity.external_id
                    FROM {bot} AS bot
                    JOIN {owner} AS owner ON owner.account_id = bot.account_id
                    JOIN {app} AS app
                      ON app.account_id = bot.account_id AND app.app_id = bot.app_id
                    JOIN external_principal_app_identity AS identity
                      ON identity.principal_id = owner.canonical_owner_principal_id
                     AND identity.provider = ?1 AND identity.app_id = bot.app_id
                     AND identity.identity_kind = 'open_id'
                    WHERE bot.app_id = ?2 AND bot.status = 'published'
                    "#
                ),
                params![provider, app_id],
                |row| {
                    Ok(ChatOwnerTargetView {
                        app_id: row.get(0)?,
                        external_id: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn enqueue(
        &self,
        database: &mut Database,
        command: &ChatOutboundEnqueueCommand,
    ) -> Result<ChatOutboundEnqueueResult> {
        validate_identity(&command.provider, &command.app_id)?;
        text(&command.chat_id, "chatId", MAX_CHAT_ID_BYTES)?;
        text(&command.text, "text", MAX_OUTBOUND_BYTES)?;
        text(&command.source, "source", 64)?;
        text(&command.idempotency_key, "idempotencyKey", 512)?;
        let now = now_millis();
        let id = Uuid::new_v4().to_string();
        let inserted = database.connection().execute(
            r#"
            INSERT INTO channel_chat_outbound(
                id, provider, app_id, chat_id, body, source, idempotency_key,
                uses_materials, status, attempts, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?10)
            ON CONFLICT(idempotency_key) DO NOTHING
            "#,
            params![
                id,
                command.provider,
                command.app_id,
                command.chat_id,
                command.text,
                command.source,
                command.idempotency_key,
                i64::from(command.uses_materials),
                OUTBOUND_PENDING,
                now
            ],
        )?;
        if inserted == 1 {
            return Ok(ChatOutboundEnqueueResult {
                outbound_id: id,
                duplicate: false,
            });
        }
        let existing: String = database.connection().query_row(
            "SELECT id FROM channel_chat_outbound WHERE idempotency_key = ?1",
            [&command.idempotency_key],
            |row| row.get(0),
        )?;
        Ok(ChatOutboundEnqueueResult {
            outbound_id: existing,
            duplicate: true,
        })
    }

    pub fn claim(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
        worker_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatOutboundView>> {
        validate_identity(provider, app_id)?;
        text(worker_id, "workerId", 256)?;
        let limit = limit.clamp(1, 50);
        let now = now_millis();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let ids: Vec<String> = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id FROM channel_chat_outbound
                WHERE provider = ?1 AND app_id = ?2 AND status = ?3
                  AND (lease_expires_at IS NULL OR lease_expires_at <= ?4)
                ORDER BY created_at ASC, rowid ASC
                LIMIT ?5
                "#,
            )?;
            let rows = statement.query_map(
                params![provider, app_id, OUTBOUND_PENDING, now, limit],
                |row| row.get(0),
            )?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut claimed = Vec::with_capacity(ids.len());
        for id in ids {
            transaction.execute(
                r#"
                UPDATE channel_chat_outbound
                SET lease_owner = ?2, lease_expires_at = ?3,
                    attempts = attempts + 1, updated_at = ?4
                WHERE id = ?1 AND status = ?5
                "#,
                params![
                    id,
                    worker_id,
                    now + OUTBOUND_LEASE_MILLIS,
                    now,
                    OUTBOUND_PENDING
                ],
            )?;
            let view = transaction.query_row(
                "SELECT id, chat_id, body, source, attempts FROM channel_chat_outbound WHERE id = ?1",
                [&id],
                |row| {
                    Ok(ChatOutboundView {
                        id: row.get(0)?,
                        chat_id: row.get(1)?,
                        text: row.get(2)?,
                        source: row.get(3)?,
                        attempts: row.get(4)?,
                    })
                },
            )?;
            claimed.push(view);
        }
        transaction.commit()?;
        Ok(claimed)
    }

    pub fn settle(
        &self,
        database: &mut Database,
        command: &ChatOutboundSettleCommand,
    ) -> Result<()> {
        anyhow::ensure!(
            matches!(
                command.status.as_str(),
                OUTBOUND_SENT | OUTBOUND_FAILED | OUTBOUND_UNKNOWN
            ),
            "unsupported outbound status"
        );
        database.connection().execute(
            r#"
            UPDATE channel_chat_outbound
            SET status = ?2, external_message_id = ?3, failure_code = ?4,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = ?5
            WHERE id = ?1
            "#,
            params![
                command.outbound_id,
                command.status,
                command.external_message_id,
                command.failure_code,
                now_millis()
            ],
        )?;
        Ok(())
    }

    pub fn cancel_pending(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<()> {
        validate_identity(provider, app_id)?;
        database.connection().execute(
            "UPDATE channel_chat_outbound SET status = ?3, updated_at = ?4
             WHERE provider = ?1 AND app_id = ?2 AND status = ?5",
            params![
                provider,
                app_id,
                OUTBOUND_FAILED,
                now_millis(),
                OUTBOUND_PENDING
            ],
        )?;
        Ok(())
    }
}

fn conversation_label(command: &ChatTurnSubmitCommand) -> String {
    match command.conversation_kind.as_str() {
        "p2p" => "飞书私聊".to_string(),
        "topic" => command
            .chat_name
            .as_deref()
            .map(|name| format!("飞书话题「{name}」"))
            .unwrap_or_else(|| "飞书话题".to_string()),
        _ => command
            .chat_name
            .as_deref()
            .map(|name| format!("飞书群聊「{name}」"))
            .unwrap_or_else(|| "飞书群聊".to_string()),
    }
}

fn camp_title(command: &ChatTurnSubmitCommand) -> String {
    match command.conversation_kind.as_str() {
        "p2p" => format!("飞书私聊 · {}", command.author_name.trim()),
        _ => conversation_label(command),
    }
}

/// The Thread bound to this external chat, when it is still usable for the same
/// member and folder. Anything else opens a fresh Thread on the next turn.
fn bound_camp(
    connection: &Connection,
    provider: &str,
    app_id: &str,
    chat_id: &str,
    agent_id: &str,
    materials_path: &str,
) -> Result<Option<String>> {
    Ok(connection
        .query_row(
            r#"
            SELECT mapping.camp_id
            FROM channel_chat_conversation AS mapping
            JOIN camp ON camp.id = mapping.camp_id
            WHERE mapping.provider = ?1 AND mapping.app_id = ?2
              AND mapping.chat_id = ?3
              AND camp.deletion_operation_id IS NULL
              AND camp.default_lead_agent_id = ?4
              AND camp.project_path = ?5
            "#,
            params![provider, app_id, chat_id, agent_id, materials_path],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn agent_run_result_text(connection: &Connection, agent_run_id: &str) -> Result<Option<String>> {
    let body = connection
        .query_row(
            r#"
            SELECT message.body
            FROM agent_run AS run
            JOIN camp_message AS message ON message.id = run.final_camp_message_id
            WHERE run.id = ?1 AND message.source_agent_run_id = run.id
              AND message.author_type = 'agent' AND message.tombstoned_at IS NULL
              AND json_array_length(message.effective_recipient_ids_json) = 0
            "#,
            [agent_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if body.is_some() {
        return Ok(body);
    }
    connection
        .query_row(
            r#"
            SELECT body FROM camp_message
            WHERE source_agent_run_id = ?1 AND author_type = 'agent'
              AND tombstoned_at IS NULL
              AND json_array_length(effective_recipient_ids_json) = 0
            ORDER BY sequence DESC, id DESC LIMIT 1
            "#,
            [agent_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

/// Chat mode is a member switch: the Bot answers only when its published member
/// has chat enabled and a materials folder to run in.
fn load_config(connection: &Connection, provider: &str, app_id: &str) -> Result<ChatBotConfigView> {
    let row = connection
        .query_row(
            r#"
            SELECT bot.agent_id, profile.chat_bot_enabled, profile.chat_materials_path
            FROM channel_member_bot_directory AS bot
            LEFT JOIN agent_profile AS profile ON profile.id = bot.agent_id
            WHERE bot.provider = ?1 AND bot.app_id = ?2
            "#,
            params![provider, app_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((agent_id, enabled, materials_path)) = row else {
        return Ok(ChatBotConfigView {
            provider: provider.to_string(),
            app_id: app_id.to_string(),
            agent_id: None,
            owner_only: true,
            mode: WORK_MODE.to_string(),
            materials_path: None,
        });
    };
    let materials_path = materials_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    let chat = enabled == 1 && materials_path.is_some();
    Ok(ChatBotConfigView {
        provider: provider.to_string(),
        app_id: app_id.to_string(),
        agent_id: Some(agent_id),
        owner_only: !chat,
        mode: if chat { CHAT_MODE } else { WORK_MODE }.to_string(),
        materials_path,
    })
}

fn item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatItemView> {
    Ok(ChatItemView {
        id: row.get(0)?,
        provider: row.get(1)?,
        app_id: row.get(2)?,
        requester_external_id: row.get(3)?,
        requester_name: row.get(4)?,
        destination_chat_id: row.get(5)?,
        destination_kind: row.get(6)?,
        target_external_id: row.get(7)?,
        target_name: row.get(8)?,
        target_is_owner: row.get::<_, i64>(9)? == 1,
        question: row.get(10)?,
        ask_message_id: row.get(11)?,
        ask_chat_id: row.get(12)?,
        status: row.get(13)?,
        last_report_at: row.get(14)?,
        created_at: row.get(15)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::seeded_runtime_database_owned;

    const PROVIDER: &str = "feishu";
    const APP: &str = "cli_chat_test";

    fn enable_chat(database: &mut Database, materials: &std::path::Path) {
        database
            .connection()
            .execute_batch(&format!(
                "INSERT OR IGNORE INTO feishu_account(
                    id, identity_digest, display_name, tenant_name, status, version,
                    created_at, updated_at)
                 VALUES ('account_chat', 'digest', 'Owner', 'Tenant', 'connected', 1,
                    '2026-01-01', '2026-01-01');
                 INSERT OR REPLACE INTO feishu_member_bot(
                    agent_id, account_id, app_id, bot_display_name, credential_ref,
                    status, version, created_at, updated_at, published_at)
                 VALUES ('agent_1', 'account_chat', '{APP}', '聊天 Bot', 'credential_chat',
                    'published', 1, '2026-01-01', '2026-01-01', '2026-01-01');
                 UPDATE agent_profile
                 SET chat_bot_enabled = 1, chat_materials_path = '{}'
                 WHERE id = 'agent_1';",
                materials.to_string_lossy().replace('\\', "/")
            ))
            .unwrap();
    }

    fn materials_root() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("rovai-chat-root-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn chat_mode_follows_the_member_switch_and_materials_folder() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;

        let default = service.snapshot(&mut database, PROVIDER, APP).unwrap();
        assert!(default.owner_only);
        assert_eq!(default.mode, WORK_MODE);
        assert!(default.agent_id.is_none());

        let root = materials_root();
        enable_chat(&mut database, &root);
        let chat = service.snapshot(&mut database, PROVIDER, APP).unwrap();
        assert_eq!(chat.mode, CHAT_MODE);
        assert!(!chat.owner_only);
        assert_eq!(chat.agent_id.as_deref(), Some("agent_1"));
        assert_eq!(
            chat.materials_path.as_deref(),
            Some(root.to_string_lossy().replace('\\', "/").as_str())
        );

        // A member without a materials folder can never reach chat mode.
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET chat_materials_path = NULL WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        assert_eq!(
            service.snapshot(&mut database, PROVIDER, APP).unwrap().mode,
            WORK_MODE
        );
    }

    #[test]
    fn submit_turn_runs_in_the_materials_folder_and_reuses_the_thread() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        let root = materials_root();
        enable_chat(&mut database, &root);
        let command = ChatTurnSubmitCommand {
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            chat_id: "oc_chat".to_string(),
            conversation_kind: "p2p".to_string(),
            chat_name: None,
            author_name: "请求者".to_string(),
            body: "帮我记一条备忘".to_string(),
        };
        let first = service.submit_turn(&mut database, &command).unwrap();
        let second = service.submit_turn(&mut database, &command).unwrap();
        assert_eq!(first.camp_id, second.camp_id);
        assert_ne!(first.camp_message_id, second.camp_message_id);

        let camps: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM camp", [], |row| row.get(0))
            .unwrap();
        assert_eq!(camps, 1);
        let (project_path, binding_kind): (String, String) = database
            .connection()
            .query_row(
                "SELECT project_path, project_binding_kind FROM camp WHERE id = ?1",
                [&first.camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(project_path, root.to_string_lossy().replace('\\', "/"));
        assert_eq!(binding_kind, "directory");

        // The turn is an ordinary Delivery, claimed later by the scheduler.
        let deliveries: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message_delivery WHERE status = 'waiting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(deliveries, 2);
        let pending = service
            .turn_result(&mut database, PROVIDER, APP, &first.camp_message_id)
            .unwrap();
        assert_eq!(pending.status, "pending");

        // Unattended chat must not inherit the member's bypass profile.
        let override_json: String = database
            .connection()
            .query_row(
                "SELECT permission_override_json FROM conversation LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(override_json.contains("workspace-write"));
        assert!(!override_json.contains("danger-full-access"));
        assert!(!override_json.contains("bypass"));

        let navigation = crate::read_model::ReadModelService;
        let snapshot = navigation.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.chat_bot.total_count, 1);
        assert!(snapshot.projects.is_empty());
        assert_eq!(snapshot.chat_bot.recent_camps[0].id, first.camp_id);

        // Rebinding the same external chat must not move its earlier history into Projects.
        let next_root = materials_root();
        enable_chat(&mut database, &next_root);
        let replacement = service.submit_turn(&mut database, &command).unwrap();
        assert_ne!(first.camp_id, replacement.camp_id);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET chat_bot_enabled = 0 WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        let snapshot = navigation.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.chat_bot.total_count, 2);
        assert!(snapshot.projects.is_empty());
        assert!(
            snapshot
                .chat_bot
                .recent_camps
                .iter()
                .all(|camp| camp.navigation_group_key == "chat-bot")
        );
    }

    #[test]
    fn duplicate_inbound_events_do_not_repeat_the_conversation_turn() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        let root = materials_root();
        enable_chat(&mut database, &root);
        let command = ChatInboundCommand {
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            external_message_id: "om_1".to_string(),
            chat_id: "oc_chat".to_string(),
            conversation_kind: "p2p".to_string(),
            chat_name: None,
            author_external_id: "ou_requester".to_string(),
            author_name: "请求者".to_string(),
            author_is_owner: false,
            body: "你好".to_string(),
            quote_message_id: None,
        };
        let first = service.inbound(&mut database, &command).unwrap();
        assert!(!first.duplicate);
        assert_eq!(first.mode, CHAT_MODE);
        let second = service.inbound(&mut database, &command).unwrap();
        assert!(second.duplicate);

        let turns = service
            .context(&mut database, PROVIDER, APP, "oc_chat", 10)
            .unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].body, "你好");
    }

    #[test]
    fn outbound_enqueue_is_idempotent_and_a_lease_prevents_double_claim() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        let command = ChatOutboundEnqueueCommand {
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            chat_id: "oc_chat".to_string(),
            text: "已收到".to_string(),
            source: "reply".to_string(),
            idempotency_key: "turn-1-reply".to_string(),
            uses_materials: false,
        };
        let first = service.enqueue(&mut database, &command).unwrap();
        assert!(!first.duplicate);
        let second = service.enqueue(&mut database, &command).unwrap();
        assert!(second.duplicate);
        assert_eq!(first.outbound_id, second.outbound_id);

        let claimed = service
            .claim(&mut database, PROVIDER, APP, "worker-1", 10)
            .unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].attempts, 1);
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "worker-2", 10)
                .unwrap()
                .is_empty()
        );

        service
            .settle(
                &mut database,
                &ChatOutboundSettleCommand {
                    outbound_id: first.outbound_id,
                    status: OUTBOUND_SENT.to_string(),
                    external_message_id: Some("om_sent".to_string()),
                    failure_code: None,
                },
            )
            .unwrap();
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "worker-3", 10)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn migration_210_adds_member_chat_state() {
        let database = seeded_runtime_database_owned();
        let columns: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('agent_profile')
                 WHERE name IN ('chat_bot_enabled', 'chat_materials_path')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(columns, 2);
        let conversation_columns: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('conversation')
                 WHERE name = 'permission_override_json'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(conversation_columns, 1);
        let applied: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 210",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(applied, 1);
        let (enabled, path): (i64, Option<String>) = database
            .connection()
            .query_row(
                "SELECT chat_bot_enabled, chat_materials_path FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(enabled, 0);
        assert!(path.is_none());
    }
}
