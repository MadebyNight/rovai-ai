//! ChatBot mode: configuration, independent chat transcript, communication items
//! and outbound delivery state. Chat is deliberately separate from Camp/Delivery
//! so a chat-mode Bot never creates an AgentRun.
use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
    pub owner_only: bool,
    pub mode: String,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub model_base_url: Option<String>,
    pub credential_configured: bool,
    pub materials_path: Option<String>,
    pub materials_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatBotConfigureCommand {
    pub provider: String,
    pub app_id: String,
    pub owner_only: bool,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub model_base_url: Option<String>,
    pub materials_path: Option<String>,
    pub materials_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCredentialCommand {
    pub provider: String,
    pub app_id: String,
    /// An absent value clears the stored credential.
    pub api_key: Option<String>,
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

/// Additive migration 205. Every table is chat-only state and never feeds Camp.
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
        "INSERT INTO schema_migration VALUES(205,datetime('now'))",
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

    pub fn configure(
        &self,
        database: &mut Database,
        command: &ChatBotConfigureCommand,
    ) -> Result<ChatBotConfigView> {
        validate_identity(&command.provider, &command.app_id)?;
        let model_provider = clean(command.model_provider.as_deref());
        let model_name = clean(command.model_name.as_deref());
        let model_base_url = clean(command.model_base_url.as_deref());
        let materials_path = clean(command.materials_path.as_deref());
        let materials_status = clean(command.materials_status.as_deref());
        if !command.owner_only {
            anyhow::ensure!(
                model_provider.is_some() && model_name.is_some(),
                "chat model provider and model are required before switching to chat mode"
            );
            let configured: bool = database.connection().query_row(
                "SELECT EXISTS(SELECT 1 FROM channel_chat_credential WHERE provider = ?1 AND app_id = ?2)",
                params![command.provider, command.app_id],
                |row| row.get(0),
            )?;
            anyhow::ensure!(
                configured,
                "a chat model credential is required before switching to chat mode"
            );
        }
        let now = now_millis();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let previous_materials: Option<String> = transaction
            .query_row(
                "SELECT materials_path FROM channel_chat_bot WHERE provider = ?1 AND app_id = ?2",
                params![command.provider, command.app_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        transaction.execute(
            r#"
            INSERT INTO channel_chat_bot(
                provider, app_id, owner_only, model_provider, model_name,
                model_base_url, materials_path, materials_status, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(provider, app_id) DO UPDATE SET
                owner_only = excluded.owner_only,
                model_provider = excluded.model_provider,
                model_name = excluded.model_name,
                model_base_url = excluded.model_base_url,
                materials_path = excluded.materials_path,
                materials_status = excluded.materials_status,
                updated_at = excluded.updated_at
            "#,
            params![
                command.provider,
                command.app_id,
                i64::from(command.owner_only),
                model_provider,
                model_name,
                model_base_url,
                materials_path,
                materials_status,
                now
            ],
        )?;
        if command.owner_only {
            // Switching back to the work Bot cancels unsent chat messages and
            // pauses open items; they resume only if chat mode returns.
            transaction.execute(
                "UPDATE channel_chat_outbound SET status = ?3, updated_at = ?4
                 WHERE provider = ?1 AND app_id = ?2 AND status = ?5",
                params![
                    command.provider,
                    command.app_id,
                    OUTBOUND_FAILED,
                    now,
                    OUTBOUND_PENDING
                ],
            )?;
            transaction.execute(
                "UPDATE channel_chat_item SET status = ?3, updated_at = ?4
                 WHERE provider = ?1 AND app_id = ?2 AND status = ?5",
                params![
                    command.provider,
                    command.app_id,
                    ITEM_PAUSED,
                    now,
                    ITEM_WAITING
                ],
            )?;
        } else {
            transaction.execute(
                "UPDATE channel_chat_item SET status = ?3, updated_at = ?4
                 WHERE provider = ?1 AND app_id = ?2 AND status = ?5",
                params![
                    command.provider,
                    command.app_id,
                    ITEM_WAITING,
                    now,
                    ITEM_PAUSED
                ],
            )?;
        }
        if previous_materials.as_deref() != materials_path.as_deref() {
            // Unsent answers grounded in the old folder must never reach anyone.
            transaction.execute(
                "UPDATE channel_chat_outbound SET status = ?3, updated_at = ?4
                 WHERE provider = ?1 AND app_id = ?2 AND status = ?5 AND uses_materials = 1",
                params![
                    command.provider,
                    command.app_id,
                    OUTBOUND_FAILED,
                    now,
                    OUTBOUND_PENDING
                ],
            )?;
        }
        transaction.commit()?;
        load_config(database.connection(), &command.provider, &command.app_id)
    }

    pub fn set_credential(
        &self,
        database: &mut Database,
        command: &ChatCredentialCommand,
    ) -> Result<bool> {
        validate_identity(&command.provider, &command.app_id)?;
        let now = now_millis();
        match command
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(api_key) => {
                anyhow::ensure!(
                    api_key.len() <= 8 * 1024,
                    "api key exceeds the storage limit"
                );
                database.connection().execute(
                    r#"
                    INSERT INTO channel_chat_credential(provider, app_id, api_key, updated_at)
                    VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(provider, app_id) DO UPDATE SET
                        api_key = excluded.api_key,
                        updated_at = excluded.updated_at
                    "#,
                    params![command.provider, command.app_id, api_key, now],
                )?;
                Ok(true)
            }
            None => {
                database.connection().execute(
                    "DELETE FROM channel_chat_credential WHERE provider = ?1 AND app_id = ?2",
                    params![command.provider, command.app_id],
                )?;
                Ok(false)
            }
        }
    }

    pub fn credential(
        &self,
        database: &mut Database,
        provider: &str,
        app_id: &str,
    ) -> Result<Option<String>> {
        validate_identity(provider, app_id)?;
        database
            .connection()
            .query_row(
                "SELECT api_key FROM channel_chat_credential WHERE provider = ?1 AND app_id = ?2",
                params![provider, app_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
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

fn clean(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn load_config(connection: &Connection, provider: &str, app_id: &str) -> Result<ChatBotConfigView> {
    let mut config = connection
        .query_row(
            r#"
            SELECT owner_only, model_provider, model_name, model_base_url,
                   materials_path, materials_status
            FROM channel_chat_bot WHERE provider = ?1 AND app_id = ?2
            "#,
            params![provider, app_id],
            |row| {
                let owner_only: i64 = row.get(0)?;
                Ok(ChatBotConfigView {
                    provider: provider.to_string(),
                    app_id: app_id.to_string(),
                    owner_only: owner_only == 1,
                    mode: if owner_only == 1 {
                        WORK_MODE
                    } else {
                        CHAT_MODE
                    }
                    .to_string(),
                    model_provider: row.get(1)?,
                    model_name: row.get(2)?,
                    model_base_url: row.get(3)?,
                    credential_configured: false,
                    materials_path: row.get(4)?,
                    materials_status: row.get(5)?,
                })
            },
        )
        .optional()?
        .unwrap_or_else(|| ChatBotConfigView {
            provider: provider.to_string(),
            app_id: app_id.to_string(),
            owner_only: true,
            mode: WORK_MODE.to_string(),
            model_provider: None,
            model_name: None,
            model_base_url: None,
            credential_configured: false,
            materials_path: None,
            materials_status: None,
        });
    config.credential_configured = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM channel_chat_credential WHERE provider = ?1 AND app_id = ?2)",
        params![provider, app_id],
        |row| row.get(0),
    )?;
    Ok(config)
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

    fn configure_command(owner_only: bool) -> ChatBotConfigureCommand {
        ChatBotConfigureCommand {
            provider: PROVIDER.to_string(),
            app_id: APP.to_string(),
            owner_only,
            model_provider: Some("openai-compatible".to_string()),
            model_name: Some("chat-model".to_string()),
            model_base_url: Some("https://example.invalid/v1".to_string()),
            materials_path: Some("C:/shared-materials".to_string()),
            materials_status: Some("共 2 个文件可用".to_string()),
        }
    }

    #[test]
    fn chat_mode_requires_a_configured_model_and_pauses_open_items() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;

        let default = service.snapshot(&mut database, PROVIDER, APP).unwrap();
        assert!(default.owner_only);
        assert_eq!(default.mode, WORK_MODE);
        assert!(!default.credential_configured);

        assert!(
            service
                .configure(&mut database, &configure_command(false))
                .is_err(),
            "chat mode must not start without a credential"
        );
        service
            .set_credential(
                &mut database,
                &ChatCredentialCommand {
                    provider: PROVIDER.to_string(),
                    app_id: APP.to_string(),
                    api_key: Some("test-key".to_string()),
                },
            )
            .unwrap();
        let chat = service
            .configure(&mut database, &configure_command(false))
            .unwrap();
        assert_eq!(chat.mode, CHAT_MODE);
        assert!(chat.credential_configured);

        let item = service
            .create_item(
                &mut database,
                &ChatItemCreateCommand {
                    provider: PROVIDER.to_string(),
                    app_id: APP.to_string(),
                    requester_external_id: "ou_requester".to_string(),
                    requester_name: "请求者".to_string(),
                    destination_chat_id: "oc_group".to_string(),
                    destination_kind: "group".to_string(),
                    target_external_id: "ou_target".to_string(),
                    target_name: "同事".to_string(),
                    target_is_owner: false,
                    question: "项目进展如何？".to_string(),
                    ask_message_id: Some("om_ask".to_string()),
                    ask_chat_id: Some("ou_target".to_string()),
                },
            )
            .unwrap();
        assert_eq!(item.status, ITEM_WAITING);

        let work = service
            .configure(&mut database, &configure_command(true))
            .unwrap();
        assert_eq!(work.mode, WORK_MODE);
        assert_eq!(
            service
                .item(&mut database, &item.id)
                .unwrap()
                .unwrap()
                .status,
            ITEM_PAUSED
        );
        assert!(
            service
                .waiting_items_for_target(&mut database, PROVIDER, APP, "ou_target")
                .unwrap()
                .is_empty()
        );

        service
            .configure(&mut database, &configure_command(false))
            .unwrap();
        assert_eq!(
            service
                .item(&mut database, &item.id)
                .unwrap()
                .unwrap()
                .status,
            ITEM_WAITING
        );
    }

    #[test]
    fn duplicate_inbound_events_do_not_repeat_the_conversation_turn() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        service
            .set_credential(
                &mut database,
                &ChatCredentialCommand {
                    provider: PROVIDER.to_string(),
                    app_id: APP.to_string(),
                    api_key: Some("test-key".to_string()),
                },
            )
            .unwrap();
        service
            .configure(&mut database, &configure_command(false))
            .unwrap();
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
    fn unbinding_materials_discards_unsent_material_answers() {
        let mut database = seeded_runtime_database_owned();
        let service = ChannelChatService;
        service
            .set_credential(
                &mut database,
                &ChatCredentialCommand {
                    provider: PROVIDER.to_string(),
                    app_id: APP.to_string(),
                    api_key: Some("test-key".to_string()),
                },
            )
            .unwrap();
        service
            .configure(&mut database, &configure_command(false))
            .unwrap();
        service
            .enqueue(
                &mut database,
                &ChatOutboundEnqueueCommand {
                    provider: PROVIDER.to_string(),
                    app_id: APP.to_string(),
                    chat_id: "oc_chat".to_string(),
                    text: "根据资料，项目已完成。".to_string(),
                    source: "reply".to_string(),
                    idempotency_key: "material-answer".to_string(),
                    uses_materials: true,
                },
            )
            .unwrap();
        let mut unbind = configure_command(false);
        unbind.materials_path = None;
        unbind.materials_status = None;
        service.configure(&mut database, &unbind).unwrap();
        assert!(
            service
                .claim(&mut database, PROVIDER, APP, "worker", 10)
                .unwrap()
                .is_empty()
        );
    }
}
