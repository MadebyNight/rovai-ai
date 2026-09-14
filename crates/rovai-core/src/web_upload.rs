//! Host temporary-file ingress into the existing source-reference Draft. There
//! is no new asset lifetime: after binding, Core never deletes the source file.
use crate::{
    camp_attachment::CampAttachmentStore, command::*, db::Database, draft_client::DraftClient,
    local_attachment_source::LocalAttachmentSourceRef,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadIntent {
    #[serde(default, skip_serializing_if = "UploadTarget::is_camp")]
    pub target: UploadTarget,
    pub command_id: String,
    pub camp_id: String,
    pub expected_revision: i64,
    pub display_name: String,
    pub byte_size: u64,
    pub sha256: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum UploadTarget {
    #[default]
    Camp,
    CampPending {
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "editToken")]
        edit_token: String,
    },
    SingleChat {
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    SingleChatPending {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "pendingInputId")]
        pending_input_id: String,
        #[serde(rename = "editToken")]
        edit_token: String,
    },
}
impl UploadTarget {
    fn is_camp(&self) -> bool {
        matches!(self, Self::Camp)
    }
}

pub fn snapshot(
    database: &Database,
    data_dir: &std::path::Path,
    client: &DraftClient,
    intent: &UploadIntent,
) -> Result<serde_json::Value> {
    match &intent.target {
        UploadTarget::Camp => Ok(serde_json::to_value(
            CampAttachmentStore::for_client(data_dir, client.clone())
                .load_draft(database, &intent.camp_id)?,
        )?),
        UploadTarget::CampPending { .. } => Ok(serde_json::to_value(
            crate::pending_camp_input::read_queue_for_client(database, &intent.camp_id, client)?,
        )?),
        UploadTarget::SingleChat { conversation_id }
        | UploadTarget::SingleChatPending {
            conversation_id, ..
        } => {
            let snapshot = crate::single_chat::SingleChatService::for_client(client.clone())
                .snapshot(database, conversation_id)?;
            ensure!(
                snapshot
                    .as_ref()
                    .is_some_and(|view| view.conversation.camp_id == intent.camp_id),
                "single_chat.camp_mismatch"
            );
            Ok(serde_json::to_value(snapshot)?)
        }
    }
}

#[derive(Serialize)]
pub struct BindUpload {
    client: DraftClient,
    intent: UploadIntent,
}
impl sealed::Sealed for BindUpload {}
impl DomainCommand for BindUpload {
    const TYPE: &'static str = "camp.source_attachment.upload.bind";
}

fn envelope(client: &DraftClient, intent: UploadIntent) -> Result<CommandEnvelope<BindUpload>> {
    ensure!(
        !client.is_desktop(),
        "upload requires a verified Web editor"
    );
    crate::camp_id::CampId::parse(&intent.camp_id)?;
    uuid::Uuid::parse_str(&intent.command_id)?;
    ensure!(
        intent.sha256.len() == 64 && intent.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "invalid upload digest"
    );
    Ok(CommandEnvelope {
        command_id: intent.command_id.clone(),
        actor: ActorRef::User {
            user_id: crate::current_user::CURRENT_USER_ID.into(),
        },
        camp_id: Some(intent.camp_id.clone()),
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload: BindUpload {
            client: client.clone(),
            intent,
        },
    })
}

pub fn reconcile(
    database: &Database,
    client: &DraftClient,
    intent: UploadIntent,
) -> Result<Option<CommandExecution>> {
    DomainCommandGateway.replay_if_recorded(database, &envelope(client, intent)?)
}

pub fn bind(
    database: &mut Database,
    data_dir: &std::path::Path,
    client: &DraftClient,
    intent: UploadIntent,
    source: LocalAttachmentSourceRef,
) -> Result<CommandExecution> {
    let envelope = envelope(client, intent)?;
    ensure!(
        source.id == envelope.payload.intent.command_id,
        "upload reference changed"
    );
    ensure!(
        source.display_name == envelope.payload.intent.display_name
            && source.observed_byte_size == Some(envelope.payload.intent.byte_size),
        "upload observation changed"
    );
    let store = CampAttachmentStore::for_client(data_dir, client.clone());
    DomainCommandGateway.execute(database, &envelope, |transaction| {
        let intent = &envelope.payload.intent;
        match &intent.target {
            UploadTarget::Camp => store.commit_source_attachment_in_transaction(transaction, &intent.camp_id, intent.expected_revision, source)?,
            UploadTarget::CampPending { pending_input_id, edit_token } => crate::pending_camp_input::commit_working_source_attachment_in_transaction(transaction, &intent.camp_id, pending_input_id, intent.expected_revision, edit_token, source, client)?,
            UploadTarget::SingleChat { conversation_id } => {
                ensure!(transaction.query_row("SELECT EXISTS(SELECT 1 FROM conversation WHERE id=?1 AND camp_id=?2 AND kind='single_chat' AND ended_at IS NULL)", rusqlite::params![conversation_id,intent.camp_id], |r| r.get::<_, bool>(0))?, "single_chat.camp_mismatch");
                crate::single_chat::SingleChatService::for_client(client.clone()).commit_source_attachment_in_transaction(transaction, conversation_id, intent.expected_revision, source)?;
            }
            UploadTarget::SingleChatPending { conversation_id, pending_input_id, edit_token } => crate::single_chat::SingleChatService::for_client(client.clone()).commit_pending_source_attachment_in_transaction(transaction, &intent.camp_id, conversation_id, pending_input_id, intent.expected_revision, edit_token, source)?,
        }
        Ok(CommandHandlerResult::applied("attachment.upload_bound", json!({"attachmentRefId":intent.command_id, "draftId":client.draft_id(&intent.camp_id), "revision":intent.expected_revision+1}), None))
    })
}
