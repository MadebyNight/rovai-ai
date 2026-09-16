//! Mission definition authority. Execution, membership and messages remain owned by Camp.
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    camp_id::CampId,
    collaboration::{
        CampActivationState, CampCollaborationMode, CreateCampCommand, ProjectBindingKind,
        actor_can_write_camp, admit_mission_start, append_domain_event, create_camp_in_tx,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, CommandResultStatus,
        DomainCommand, DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionStatus {
    NeedsYou,
    NotStarted,
    InProgress,
    Completed,
}
impl MissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NeedsYou => "needs_you",
            Self::NotStarted => "not_started",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionFacts {
    pub mission_id: String,
    pub title: String,
    pub status: MissionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_notice: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionInfo {
    pub mission_id: String,
    pub title: String,
    pub description: String,
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionRecord {
    #[serde(flatten)]
    pub info: MissionInfo,
    pub camp_id: String,
    pub project_path: String,
    pub project_binding_kind: ProjectBindingKind,
    pub details_version: i64,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub member_agent_ids: Vec<String>,
    pub default_lead_agent_id: Option<String>,
    pub running_agent_ids: Vec<String>,
    pub has_unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMissionCommand {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub project_path: String,
    pub project_binding_kind: ProjectBindingKind,
    pub member_agent_ids: Vec<String>,
    pub default_lead_agent_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
}
impl sealed::Sealed for CreateMissionCommand {}
impl DomainCommand for CreateMissionCommand {
    const TYPE: &'static str = "mission.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MissionGetInput {}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionUpdateInput {
    pub title: Option<String>,
    pub description: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMissionCommand {
    pub mission_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub expected_details_version: Option<i64>,
}
impl sealed::Sealed for UpdateMissionCommand {}
impl DomainCommand for UpdateMissionCommand {
    const TYPE: &'static str = "mission.update";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionStatusInput {
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatusMissionCommand {
    pub mission_id: String,
    pub status: MissionStatus,
    pub source_message_id: Option<String>,
}
impl sealed::Sealed for StatusMissionCommand {}
impl DomainCommand for StatusMissionCommand {
    const TYPE: &'static str = "mission.status";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartMissionCommand {
    pub mission_id: String,
}
impl sealed::Sealed for StartMissionCommand {}
impl DomainCommand for StartMissionCommand {
    const TYPE: &'static str = "mission.start";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionActivity {
    pub id: i64,
    pub kind: String,
    pub actor_type: String,
    pub actor_id: String,
    pub changes: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkMissionPrCommand {
    pub mission_id: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub remove: bool,
}
impl sealed::Sealed for LinkMissionPrCommand {}
impl DomainCommand for LinkMissionPrCommand {
    const TYPE: &'static str = "mission.link_pr";
}

#[derive(Default)]
pub struct MissionService {
    gateway: DomainCommandGateway,
}
impl MissionService {
    pub fn link_pr(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<LinkMissionPrCommand>,
    ) -> Result<CommandExecution> {
        let input = &envelope.payload;
        let url = url::Url::parse(&input.url).context("mission.invalid_pr_url")?;
        ensure!(
            matches!(url.scheme(), "https" | "http")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && input.url.len() <= 4096
                && input.title.chars().count() <= 200,
            "mission.invalid_pr_url"
        );
        self.gateway.execute(database,envelope,|tx|{
            if !matches!(envelope.actor,ActorRef::User{..}) {return Ok(reject("mission.user_required"));}
            if load_record(tx,&input.mission_id)?.is_none() {return Ok(reject("mission.not_found"));}
            let changed=if input.remove {tx.execute("DELETE FROM mission_pr WHERE mission_id=?1 AND url=?2",params![input.mission_id,url.as_str()])?} else {
                tx.execute("INSERT INTO mission_pr(id,mission_id,url,title,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(mission_id,url) DO UPDATE SET title=excluded.title WHERE title<>excluded.title",params![Uuid::new_v4().to_string(),input.mission_id,url.as_str(),input.title.trim(),chrono::Utc::now().to_rfc3339()])?
            };
            if changed>0 {record_activity(tx,&input.mission_id,"pull_request",&envelope.actor,None,json!({"url":url.as_str(),"title":input.title,"removed":input.remove}))?;}
            Ok(mutation(&input.mission_id,changed>0))
        })
    }
    pub fn start(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<StartMissionCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database,envelope,|tx| {
            if !matches!(envelope.actor,ActorRef::User{..}) { return Ok(reject("mission.user_required")); }
            let Some(mission)=load_record(tx,&envelope.payload.mission_id)? else { return Ok(reject("mission.not_found")); };
            let active:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE c.camp_id=?1 AND r.status IN ('queued','running','waiting'))",[&mission.camp_id],|r|r.get(0))?;
            let result=if active {
                CommandHandlerResult::applied("mission.already_running",json!({"missionId":mission.info.mission_id,"campId":mission.camp_id,"alreadyRunning":true}),None)
            } else { admit_mission_start(tx,&envelope.actor,&envelope.command_id,&mission)? };
            if result.status==CommandResultStatus::Rejected { return Ok(result); }
            tx.execute("UPDATE mission SET status='in_progress',source_message_id=NULL,updated_at=?2 WHERE id=?1",params![mission.info.mission_id,chrono::Utc::now().to_rfc3339()])?;
            if !active || mission.info.status != MissionStatus::InProgress {
                record_activity(tx,&mission.info.mission_id,"started",&envelope.actor,None,json!({"status":"in_progress"}))?;
            }
            Ok(result)
        })
    }
    pub fn create(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateMissionCommand>,
    ) -> Result<CommandExecution> {
        let input = &envelope.payload;
        validate_content(Some(&input.title), Some(&input.description))?;
        let tags = normalize_tags(&input.tags)?;
        self.gateway.execute(database, envelope, |tx| {
            let mission_id = format!("rvm_{}", Uuid::now_v7().simple());
            let camp_id = CampId::new();
            let created = create_camp_in_tx(tx, &envelope.actor, envelope.execution_epoch, &CreateCampCommand {
                name: Some(input.title.trim().chars().take(80).collect()),
                project_binding_kind: input.project_binding_kind, project_path: input.project_path.clone(),
                member_agent_ids: input.member_agent_ids.clone(), default_lead_agent_id: input.default_lead_agent_id.clone(),
                collaboration_mode: CampCollaborationMode::Peer, activation_state: CampActivationState::Active,
            }, &camp_id)?;
            if created.status == CommandResultStatus::Rejected { return Ok(created); }
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute("INSERT INTO mission(id,camp_id,title,description,status,tags_json,details_version,created_at,updated_at) VALUES(?1,?2,?3,?4,'not_started',?5,1,?6,?6)",
                params![mission_id,camp_id,input.title.trim(),input.description,serde_json::to_string(&tags)?,now])?;
            record_activity(tx, &mission_id, "created", &envelope.actor, envelope.execution_epoch,
                json!({"title":input.title.trim(),"description":input.description,"status":"not_started","tags":tags}))?;
            Ok(CommandHandlerResult::applied("mission.created", json!({"missionId":mission_id,"campId":camp_id}),
                Some(EntityReference { entity_type: "mission".into(), entity_id: mission_id })))
        })
    }

    pub fn update(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateMissionCommand>,
    ) -> Result<CommandExecution> {
        let input = &envelope.payload;
        ensure!(
            input.title.is_some() || input.description.is_some() || input.tags.is_some(),
            "mission.content_required"
        );
        validate_content(input.title.as_deref(), input.description.as_deref())?;
        let tags = input.tags.as_deref().map(normalize_tags).transpose()?;
        self.gateway.execute(database, envelope, |tx| {
            let Some(current) = load_record(tx, &input.mission_id)? else { return Ok(reject("mission.not_found")); };
            if !can_edit(tx, envelope, &current)? || (tags.is_some() && !matches!(envelope.actor, ActorRef::User { .. })) {
                return Ok(reject("mission.forbidden"));
            }
            let edits_details = input.title.is_some() || input.description.is_some();
            if edits_details && matches!(envelope.actor, ActorRef::User { .. }) {
                let Some(expected) = input.expected_details_version else {
                    return Ok(reject("mission.details_version_required"));
                };
                if expected != current.details_version {
                    return Ok(CommandHandlerResult::rejected(
                        "mission.details_version_conflict",
                        json!({
                            "missionId": current.info.mission_id,
                            "currentTitle": current.info.title,
                            "currentDescription": current.info.description,
                            "currentDetailsVersion": current.details_version,
                        }),
                    ));
                }
            }
            let title = input.title.as_deref().map(str::trim).unwrap_or(&current.info.title);
            let description = input.description.as_deref().unwrap_or(&current.info.description);
            let next_tags = tags.as_ref().unwrap_or(&current.tags);
            let mut changes = serde_json::Map::new();
            if title != current.info.title { changes.insert("title".into(), json!(title)); }
            if description != current.info.description { changes.insert("description".into(), json!(description)); }
            if next_tags != &current.tags { changes.insert("tags".into(), json!(next_tags)); }
            if changes.is_empty() { return Ok(mutation(&input.mission_id, false)); }
            let details_changed = title != current.info.title || description != current.info.description;
            tx.execute("UPDATE mission SET title=?2,description=?3,tags_json=?4,details_version=details_version+?5,updated_at=?6 WHERE id=?1",
                params![input.mission_id,title,description,serde_json::to_string(next_tags)?,i64::from(details_changed),chrono::Utc::now().to_rfc3339()])?;
            if changes.contains_key("title") {
            tx.execute("UPDATE camp SET title=?2,name_origin='user',version=version+1,updated_at=?3 WHERE id=?1",
                params![current.camp_id,title.chars().take(80).collect::<String>(),chrono::Utc::now().to_rfc3339()])?;
            }
            record_activity(tx, &input.mission_id, "updated", &envelope.actor, envelope.execution_epoch, Value::Object(changes))?;
            Ok(mutation(&input.mission_id, true))
        })
    }

    pub fn status(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<StatusMissionCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |tx| {
            let input = &envelope.payload;
            let Some(current) = load_record(tx, &input.mission_id)? else { return Ok(reject("mission.not_found")); };
            if !can_edit(tx, envelope, &current)? { return Ok(reject("mission.forbidden")); }
            if matches!(envelope.actor, ActorRef::Agent {..}) && matches!(input.status, MissionStatus::NeedsYou | MissionStatus::Completed) && input.source_message_id.is_none() {
                return Ok(reject("mission.source_message_required"));
            }
            if let Some(source) = &input.source_message_id {
                let sql = format!("WITH {} SELECT EXISTS(SELECT 1 FROM camp_message m JOIN public_camp_message_publication p ON p.message_id=m.id WHERE m.id=?1 AND m.camp_id=?2 AND m.tombstoned_at IS NULL)", crate::camp_message_publication::public_camp_message_publication_cte());
                let valid: bool = tx.query_row(&sql, params![source,current.camp_id], |row| row.get(0))?;
                if !valid { return Ok(reject("mission.invalid_source_message")); }
            }
            if current.info.status == input.status && current.info.source_message_id == input.source_message_id { return Ok(mutation(&input.mission_id, false)); }
            tx.execute("UPDATE mission SET status=?2,source_message_id=?3,updated_at=?4 WHERE id=?1",
                params![input.mission_id,input.status.as_str(),input.source_message_id,chrono::Utc::now().to_rfc3339()])?;
            record_activity(tx, &input.mission_id, "status", &envelope.actor, envelope.execution_epoch, json!({"status":input.status,"sourceMessageId":input.source_message_id}))?;
            Ok(mutation(&input.mission_id, true))
        })
    }

    pub fn get(&self, database: &Database, mission_id: &str) -> Result<Option<MissionRecord>> {
        load_record(database.connection(), mission_id)
    }
    pub fn list(&self, database: &Database) -> Result<Vec<MissionRecord>> {
        let mut statement = database
            .connection()
            .prepare("SELECT id FROM mission ORDER BY updated_at DESC,id DESC")?;
        let ids = statement
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.iter()
            .map(|id| {
                load_record(database.connection(), id)?
                    .context("Mission disappeared during locked read")
            })
            .collect()
    }
    pub fn activity(
        &self,
        database: &Database,
        mission_id: &str,
        before: Option<i64>,
    ) -> Result<Vec<MissionActivity>> {
        let mut statement = database.connection().prepare("SELECT id,kind,actor_type,actor_id,changes_json,created_at FROM mission_activity WHERE mission_id=?1 AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT 100")?;
        let rows = statement
            .query_map(params![mission_id, before], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, String>(4)?,
                    r.get(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(id, kind, actor_type, actor_id, changes, created_at)| {
                Ok(MissionActivity {
                    id,
                    kind,
                    actor_type,
                    actor_id,
                    changes: serde_json::from_str(&changes)?,
                    created_at,
                })
            })
            .collect()
    }
}

pub(crate) fn mission_for_camp(
    connection: &Connection,
    camp_id: &str,
) -> Result<Option<MissionRecord>> {
    let id = connection
        .query_row("SELECT id FROM mission WHERE camp_id=?1", [camp_id], |r| {
            r.get::<_, String>(0)
        })
        .optional()?;
    id.map(|id| load_record(connection, &id)?.context("Mission association missing"))
        .transpose()
}

pub(crate) fn mark_details_read(
    connection: &Connection,
    mission_id: &str,
    agent_run_id: &str,
    details_version: i64,
) -> Result<()> {
    connection.execute(
        "INSERT INTO mission_details_read(
            conversation_id,mission_id,baseline_details_version,last_read_details_version,updated_at
         )
         SELECT conversation_id,?2,?3,?3,?4 FROM agent_run WHERE id=?1
         ON CONFLICT(conversation_id) DO UPDATE SET
            mission_id=excluded.mission_id,
            last_read_details_version=excluded.last_read_details_version,
            updated_at=excluded.updated_at",
        params![
            agent_run_id,
            mission_id,
            details_version,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn load_record(connection: &Connection, id: &str) -> Result<Option<MissionRecord>> {
    let row = connection.query_row("SELECT m.id,m.camp_id,m.title,m.description,m.status,m.source_message_id,m.tags_json,m.details_version,m.created_at,m.updated_at,c.project_path,c.project_binding_kind,c.default_lead_agent_id FROM mission m JOIN camp c ON c.id=m.camp_id WHERE m.id=?1", [id], |r| Ok((
        r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,String>(6)?,r.get::<_,i64>(7)?,r.get::<_,String>(8)?,r.get::<_,String>(9)?,r.get::<_,String>(10)?,r.get::<_,String>(11)?,r.get::<_,Option<String>>(12)?))).optional()?;
    let Some((
        mission_id,
        camp_id,
        title,
        description,
        status,
        source_message_id,
        tags,
        details_version,
        created_at,
        updated_at,
        project_path,
        binding,
        default_lead_agent_id,
    )) = row
    else {
        return Ok(None);
    };
    let strings = |sql: &str| -> Result<Vec<String>> {
        Ok(connection
            .prepare(sql)?
            .query_map([&camp_id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    };
    let unread_sql = format!(
        "WITH {} SELECT EXISTS(SELECT 1 FROM camp_message m JOIN public_camp_message_publication p ON p.message_id=m.id WHERE m.camp_id=?1 AND m.author_type='agent' AND m.tombstoned_at IS NULL AND p.global_sequence>COALESCE((SELECT last_seen_global_sequence FROM camp_view_state WHERE camp_id=?1),0))",
        crate::camp_message_publication::public_camp_message_publication_cte()
    );
    let has_unread = connection.query_row(&unread_sql, [&camp_id], |r| r.get(0))?;
    Ok(Some(MissionRecord {
        has_unread,
        info: MissionInfo {
            mission_id,
            title,
            description,
            status: serde_json::from_value(json!(status))?,
            source_message_id,
        },
        member_agent_ids: strings(
            "SELECT agent_id FROM camp_member WHERE camp_id=?1 AND status='active' ORDER BY joined_at,agent_id",
        )?,
        running_agent_ids: strings(
            "SELECT DISTINCT c.agent_id FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE c.camp_id=?1 AND r.status IN ('running','waiting') ORDER BY c.agent_id",
        )?,
        camp_id,
        project_path,
        project_binding_kind: serde_json::from_value(json!(binding))?,
        details_version,
        tags: serde_json::from_str(&tags)?,
        created_at,
        updated_at,
        default_lead_agent_id,
    }))
}
fn validate_content(title: Option<&str>, description: Option<&str>) -> Result<()> {
    if let Some(title) = title {
        ensure!(
            !title.trim().is_empty() && title.trim().chars().count() <= 200,
            "mission.invalid_title"
        );
    }
    if let Some(description) = description {
        ensure!(
            description.chars().count() <= 12_000,
            "mission.description_too_long"
        );
    }
    Ok(())
}
fn normalize_tags(tags: &[String]) -> Result<Vec<String>> {
    ensure!(tags.len() <= 30, "mission.too_many_tags");
    let mut values = Vec::new();
    let mut keys = std::collections::HashSet::new();
    for tag in tags {
        let value = tag.trim();
        ensure!(
            !value.is_empty() && value.chars().count() <= 24,
            "mission.invalid_tag"
        );
        if keys.insert(value.to_lowercase()) {
            values.push(value.to_string());
        }
    }
    Ok(values)
}
fn can_edit<T>(
    tx: &Transaction<'_>,
    envelope: &CommandEnvelope<T>,
    current: &MissionRecord,
) -> Result<bool> {
    if matches!(envelope.actor, ActorRef::System { .. }) {
        return Ok(false);
    }
    if matches!(envelope.actor, ActorRef::Agent { .. })
        && envelope.camp_id.as_deref() != Some(&current.camp_id)
    {
        return Ok(false);
    }
    actor_can_write_camp(
        tx,
        &envelope.actor,
        envelope.execution_epoch,
        &current.camp_id,
    )
}
fn reject(code: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({"message":code}))
}
fn mutation(id: &str, changed: bool) -> CommandHandlerResult {
    CommandHandlerResult::applied(
        "mission.updated",
        json!({"missionId":id,"changed":changed}),
        Some(EntityReference {
            entity_type: "mission".into(),
            entity_id: id.into(),
        }),
    )
}
pub(crate) fn record_activity(
    tx: &Transaction<'_>,
    mission_id: &str,
    kind: &str,
    actor: &ActorRef,
    epoch: Option<i64>,
    changes: Value,
) -> Result<()> {
    let (actor_type, actor_id) = match actor {
        ActorRef::User { user_id } => ("user", user_id),
        ActorRef::Agent { agent_id, .. } => ("agent", agent_id),
        ActorRef::System { component_id } => ("system", component_id),
    };
    tx.execute("INSERT INTO mission_activity(mission_id,kind,actor_type,actor_id,changes_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![mission_id,kind,actor_type,actor_id,serde_json::to_string(&changes)?,chrono::Utc::now().to_rfc3339()])?;
    let camp_id: String = tx.query_row(
        "SELECT camp_id FROM mission WHERE id=?1",
        [mission_id],
        |r| r.get(0),
    )?;
    append_domain_event(
        tx,
        "mission.updated",
        Some(&camp_id),
        Some(("mission", mission_id)),
        actor,
        epoch,
        &json!({"missionId":mission_id,"kind":kind,"changes":changes}),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command<P>(payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: None,
            expected_versions: vec![],
            execution_epoch: None,
            payload,
        }
    }
    #[test]
    fn mission_commands_keep_definition_atomic_patch_only_and_start_idempotent() {
        let mut db = crate::test_support::seeded_runtime_database_owned();
        let directory = db.directory().join("workspace");
        std::fs::create_dir_all(&directory).unwrap();
        let service = MissionService::default();
        let create = command(CreateMissionCommand {
            title: "使命".repeat(65),
            description: "original".into(),
            project_path: directory.to_str().unwrap().into(),
            project_binding_kind: ProjectBindingKind::Directory,
            member_agent_ids: vec!["agent_1".into(), "agent_2".into()],
            default_lead_agent_id: "agent_1".into(),
            tags: vec![" UI ".into(), "ui".into()],
        });
        let created = service.create(&mut db, &create).unwrap();
        assert_eq!(created.result.code, "mission.created");
        let id = created.result.payload["missionId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            service.create(&mut db, &create).unwrap().result.payload,
            created.result.payload
        );
        let record = service.get(&db, &id).unwrap().unwrap();
        assert_eq!(record.info.title.chars().count(), 130);
        assert_eq!(record.tags, vec!["UI"]);
        assert_eq!(record.info.status, MissionStatus::NotStarted);
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM agent_run", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_workspace", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        for (title, description, expected_details_version) in [
            (Some("new".into()), None, 1),
            (None, Some("next".into()), 2),
        ] {
            service
                .update(
                    &mut db,
                    &command(UpdateMissionCommand {
                        mission_id: id.clone(),
                        title,
                        description,
                        tags: None,
                        expected_details_version: Some(expected_details_version),
                    }),
                )
                .unwrap();
        }
        let record = service.get(&db, &id).unwrap().unwrap();
        assert_eq!(record.info.title, "new");
        assert_eq!(record.info.description, "next");
        assert_eq!(record.details_version, 3);
        let before = service.activity(&db, &id, None).unwrap().len();
        assert_eq!(
            service
                .update(
                    &mut db,
                    &command(UpdateMissionCommand {
                        mission_id: id.clone(),
                        title: Some("new".into()),
                        description: None,
                        tags: None,
                        expected_details_version: Some(3),
                    })
                )
                .unwrap()
                .result
                .payload["changed"],
            false
        );
        assert_eq!(service.get(&db, &id).unwrap().unwrap().details_version, 3);
        let stale = service
            .update(
                &mut db,
                &command(UpdateMissionCommand {
                    mission_id: id.clone(),
                    title: Some("stale".into()),
                    description: Some("stale".into()),
                    tags: None,
                    expected_details_version: Some(2),
                }),
            )
            .unwrap();
        assert_eq!(stale.result.code, "mission.details_version_conflict");
        assert_eq!(stale.result.payload["currentDetailsVersion"], 3);
        assert_eq!(service.activity(&db, &id, None).unwrap().len(), before);
        let mut invalid = create.clone();
        invalid.command_id = Uuid::new_v4().to_string();
        invalid.payload.default_lead_agent_id = "missing".into();
        assert_eq!(
            service.create(&mut db, &invalid).unwrap().result.status,
            CommandResultStatus::Rejected
        );
        assert_eq!(service.list(&db).unwrap().len(), 1);
        let start = command(StartMissionCommand {
            mission_id: id.clone(),
        });
        let started = service.start(&mut db, &start).unwrap();
        assert_eq!(
            started.result.status,
            CommandResultStatus::Accepted,
            "{:?}",
            started.result
        );
        assert_eq!(
            service.start(&mut db, &start).unwrap().result.payload,
            started.result.payload
        );
        assert_eq!(
            service
                .start(
                    &mut db,
                    &command(StartMissionCommand {
                        mission_id: id.clone()
                    })
                )
                .unwrap()
                .result
                .payload["alreadyRunning"],
            true
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_start", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.connection()
                .query_row("SELECT COUNT(*) FROM mission_workspace", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            service.get(&db, &id).unwrap().unwrap().info.status,
            MissionStatus::InProgress
        );
        service
            .status(
                &mut db,
                &command(StatusMissionCommand {
                    mission_id: id.clone(),
                    status: MissionStatus::Completed,
                    source_message_id: None,
                }),
            )
            .unwrap();
        assert_eq!(
            db.connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE status='queued'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        let info = serde_json::to_value(service.get(&db, &id).unwrap().unwrap().info).unwrap();
        assert_eq!(info.as_object().unwrap().len(), 5);
        assert!(info.get("workspace").is_none());
        assert!(info.get("version").is_none());
        let result = service
            .status(
                &mut db,
                &command(StatusMissionCommand {
                    mission_id: id.clone(),
                    status: MissionStatus::NeedsYou,
                    source_message_id: Some("outside".into()),
                }),
            )
            .unwrap();
        assert_eq!(result.result.code, "mission.invalid_source_message");

        // The running member remains allowed after another member becomes lead.
        let runtime = crate::runtime::ExecutionRuntimeService::default();
        let candidate = runtime
            .list_dispatchable_agent_runs(&db, 10)
            .unwrap()
            .remove(0);
        let mut claim = command(crate::runtime::ClaimAgentRunCommand {
            agent_run_id: candidate.agent_run_id.clone(),
            expected_version: candidate.version,
            lease_owner: "mission-test".into(),
            lease_seconds: 60,
            workspace: Some(candidate.execution_workspace()),
            starting_git_observation: None,
        });
        claim.actor = ActorRef::System {
            component_id: "agent-run-scheduler".into(),
        };
        claim.camp_id = Some(record.camp_id.clone());
        let claimed = runtime.claim_agent_run(&mut db, &claim).unwrap();
        assert_eq!(claimed.result.code, "agent_run.claimed");
        let epoch = claimed.result.payload["executionEpoch"].as_i64().unwrap();
        db.connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id='agent_2' WHERE id=?1",
                [&record.camp_id],
            )
            .unwrap();
        let mut edit = command(UpdateMissionCommand {
            mission_id: id.clone(),
            title: Some("member edit".into()),
            description: None,
            tags: None,
            expected_details_version: None,
        });
        edit.actor = ActorRef::Agent {
            agent_id: "agent_1".into(),
            source_agent_run_id: candidate.agent_run_id.clone(),
        };
        edit.camp_id = Some(record.camp_id.clone());
        edit.execution_epoch = Some(epoch);
        assert_eq!(
            service.update(&mut db, &edit).unwrap().result.payload["changed"],
            true
        );
        assert_eq!(
            service.get(&db, &id).unwrap().unwrap().info.description,
            "next"
        );
        assert_eq!(service.get(&db, &id).unwrap().unwrap().details_version, 4);
        let frozen: (String, String) = db
            .connection()
            .query_row(
                "SELECT title,description FROM mission_start WHERE mission_id=?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(frozen, ("new".into(), "next".into()));
        let mut state = CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: edit.actor.clone(),
            camp_id: edit.camp_id.clone(),
            expected_versions: vec![],
            execution_epoch: edit.execution_epoch,
            payload: StatusMissionCommand {
                mission_id: id.clone(),
                status: MissionStatus::NeedsYou,
                source_message_id: None,
            },
        };
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.code,
            "mission.source_message_required"
        );
        let source: String = db
            .connection()
            .query_row(
                "SELECT message_id FROM mission_start WHERE mission_id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        state.command_id = Uuid::new_v4().to_string();
        state.payload.source_message_id = Some(source.clone());
        let status = service.status(&mut db, &state).unwrap();
        assert_eq!(status.result.payload["changed"], true);
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.payload,
            status.result.payload
        );
        db.connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at=?2 WHERE id=?1",
                params![source, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        state.command_id = Uuid::new_v4().to_string();
        state.payload.status = MissionStatus::Completed;
        assert_eq!(
            service.status(&mut db, &state).unwrap().result.code,
            "mission.invalid_source_message"
        );
        // Cross-Camp and removed-member callers cannot keep editing with a live Run.
        edit.command_id = Uuid::new_v4().to_string();
        edit.camp_id = None;
        assert_eq!(
            service.update(&mut db, &edit).unwrap().result.code,
            "mission.forbidden"
        );
        edit.command_id = Uuid::new_v4().to_string();
        edit.camp_id = Some(record.camp_id.clone());
        db.connection().execute("UPDATE camp_member SET leave_requested_at=?2,leave_request_command_id='fixture-leave' WHERE camp_id=?1 AND agent_id='agent_1'",params![record.camp_id,chrono::Utc::now().to_rfc3339()]).unwrap();
        assert_eq!(
            service.update(&mut db, &edit).unwrap().result.code,
            "mission.forbidden"
        );
    }
}
