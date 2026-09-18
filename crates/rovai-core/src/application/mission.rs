//! Desktop Mission application orchestration. Git work is kept outside the database lock.
use super::*;
use crate::mission::{
    CreateMissionCommand, MissionAttachmentUpdate, MissionService, StartMissionCommand,
    StatusMissionCommand, UpdateMissionCommand,
};
use crate::mission_workspace::{self, GitRepository, MissionGit, MissionWorkspace, NameOccupied};
use rusqlite::{OptionalExtension, params};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MissionSourceAttachmentPathInput {
    id: String,
    source_path: String,
    display_name: String,
    media_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateMissionWithAttachmentsParams {
    command_id: String,
    command: CreateMissionCommand,
    attachments: Vec<MissionSourceAttachmentPathInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateMissionWithAttachmentsParams {
    command_id: String,
    command: UpdateMissionCommand,
    keep_attachment_ids: Vec<String>,
    attachments: Vec<MissionSourceAttachmentPathInput>,
}

async fn observe_mission_source_attachments(
    inputs: Vec<MissionSourceAttachmentPathInput>,
) -> Result<Vec<rovai_core::local_attachment_source::LocalAttachmentSourceRef>> {
    anyhow::ensure!(
        inputs.len() <= rovai_core::camp_attachment::MAX_PREPARED_ATTACHMENTS,
        "mission.too_many_attachments"
    );
    tokio::task::spawn_blocking(move || {
        inputs
            .into_iter()
            .map(|input| {
                let canonical_id = uuid::Uuid::parse_str(&input.id)?.hyphenated().to_string();
                anyhow::ensure!(canonical_id == input.id, "mission.invalid_attachment_id");
                let mut source = observe_source_attachment(
                    Path::new(&input.source_path),
                    &input.display_name,
                    input.media_type.as_deref(),
                )?;
                source.id = input.id;
                Ok(source)
            })
            .collect::<Result<Vec<_>>>()
    })
    .await
    .context("Mission Source Attachment observation task failed")?
}

impl Core {
    async fn mission_git(&self) -> Result<MissionGit> {
        MissionGit::new(
            self.runtime_search_environment
                .read()
                .await
                .resolve_command_path("git")
                .context("mission.git_unavailable")?,
        )
    }
    pub(super) async fn prepare_mission_workspace(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
    ) -> Result<Option<rovai_core::runtime::AgentRunWorkspace>> {
        let _preparation = self.mission_workspace_gate.lock().await;
        let (mission, existing, host) = {
            let mut database = self.database.lock().await;
            let Some(mission) =
                crate::mission::mission_for_camp(database.connection(), &candidate.camp_id)?
            else {
                return Ok(Some(candidate.execution_workspace()));
            };
            if !ExecutionRuntimeService::default()
                .begin_workspace_preparation(&mut database, candidate)?
            {
                return Ok(None);
            }
            let host: String = database.connection().query_row(
                "SELECT id FROM mission_execution_host WHERE singleton=1",
                [],
                |r| r.get(0),
            )?;
            let existing = mission_workspace::load_workspaces(
                database.connection(),
                &mission.info.mission_id,
            )?;
            (mission, existing, host)
        };
        let mut execution = candidate.execution_workspace();
        let source = Path::new(&mission.project_path);
        if existing.is_empty() && !mission_workspace::has_git_marker(source) {
            // An unavailable Git executable cannot change non-Git execution behavior.
            if self
                .runtime_search_environment
                .read()
                .await
                .resolve_command_path("git")
                .is_none()
            {
                return Ok(Some(execution));
            }
        }
        let git = self.mission_git().await?;
        let mut workspace = if let Some(saved) = existing.into_iter().next() {
            anyhow::ensure!(
                saved.execution_host_id == host,
                "mission.execution_host_unavailable"
            );
            anyhow::ensure!(
                matches!(saved.state.as_str(), "preparing" | "ready"),
                "mission.workspace_cleanup_pending"
            );
            saved
        } else {
            let Some(repository) = git.inspect(source).await? else {
                return Ok(Some(execution));
            };
            let workspace = select_candidate(&git, &repository, &mission, &host, 1).await?;
            let database = self.database.lock().await;
            mission_workspace::persist_plan(database.connection(), &workspace)?;
            workspace
        };
        if workspace.state == "preparing" {
            loop {
                match git.materialize(&workspace).await {
                    Ok(()) => break,
                    Err(error) if error.is::<NameOccupied>() => {
                        git.abandon_candidate(&workspace).await?;
                        // Keep the first resolved base even when a name was occupied during creation.
                        let root = PathBuf::from(&workspace.repository_root);
                        let relative = Path::new(&workspace.working_directory)
                            .strip_prefix(&workspace.worktree_path)?
                            .to_path_buf();
                        let repository = GitRepository {
                            root,
                            common_dir: workspace.git_common_dir.clone().into(),
                            base_branch: workspace.base_branch.clone(),
                            base_sha: workspace.base_sha.clone(),
                            relative_directory: relative,
                        };
                        let mut next =
                            select_candidate(&git, &repository, &mission, &host, 2).await?;
                        next.id = workspace.id.clone();
                        next.preparation_token = workspace.preparation_token.clone();
                        let database = self.database.lock().await;
                        database.connection().execute("UPDATE mission_workspace SET worktree_path=?2,working_directory=?3,branch=?4,updated_at=?5 WHERE id=?1 AND state='preparing'",params![next.id,next.worktree_path,next.working_directory,next.branch,chrono::Utc::now().to_rfc3339()])?;
                        workspace = next;
                    }
                    Err(error) => {
                        let database = self.database.lock().await;
                        database.connection().execute(
                            "UPDATE mission_workspace SET diagnostic=?2,updated_at=?3 WHERE id=?1",
                            params![
                                workspace.id,
                                format!("{error:#}"),
                                chrono::Utc::now().to_rfc3339()
                            ],
                        )?;
                        return Err(error);
                    }
                }
            }
            let database = self.database.lock().await;
            database.connection().execute("UPDATE mission_workspace SET state='ready',diagnostic=NULL,updated_at=?2 WHERE id=?1 AND state='preparing'",params![workspace.id,chrono::Utc::now().to_rfc3339()])?;
            workspace.state = "ready".into();
        }
        git.validate(&workspace).await?;
        let actual = git::validate_workspace_directory(
            Path::new(&workspace.working_directory),
            &self.data_dir,
            false,
        )?;
        anyhow::ensure!(
            git::persisted_workspace_path_matches_canonical(
                Path::new(&workspace.working_directory),
                &actual
            ),
            "mission.working_directory_changed"
        );
        execution.execution_root = workspace.working_directory;
        execution.isolation = "git_worktree".into();
        if let Some(frozen) = &candidate.workspace {
            anyhow::ensure!(frozen == &execution, "mission.frozen_workspace_mismatch");
        }
        Ok(Some(execution))
    }

    pub(super) async fn cleanup_mission_workspaces_locked(
        &self,
        camp_id: Option<&str>,
    ) -> Result<()> {
        let workspaces = {
            let database = self.database.lock().await;
            let mut statement=database.connection().prepare("SELECT DISTINCT mission_id FROM mission_workspace WHERE state IN ('cleanup_pending','cleanup_failed') AND (?1 IS NULL OR camp_id=?1) AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id)")?;
            let ids = statement
                .query_map([camp_id], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut rows = Vec::new();
            for id in ids {
                rows.extend(mission_workspace::load_workspaces(
                    database.connection(),
                    &id,
                )?);
            }
            rows
        };
        if workspaces.is_empty() {
            return Ok(());
        }
        let git = self.mission_git().await?;
        let host = {
            let database = self.database.lock().await;
            database.connection().query_row(
                "SELECT id FROM mission_execution_host WHERE singleton=1",
                [],
                |r| r.get::<_, String>(0),
            )?
        };
        for workspace in workspaces {
            let result = if workspace.execution_host_id == host {
                git.cleanup(&workspace).await
            } else {
                Err(anyhow::anyhow!("mission.execution_host_unavailable"))
            };
            let database = self.database.lock().await;
            match result {
                Ok(()) => {
                    database
                        .connection()
                        .execute("DELETE FROM mission_workspace WHERE id=?1", [workspace.id])?;
                }
                Err(error) => {
                    database.connection().execute("UPDATE mission_workspace SET state='cleanup_failed',diagnostic=?2,updated_at=?3 WHERE id=?1",params![workspace.id,format!("{error:#}"),chrono::Utc::now().to_rfc3339()])?;
                }
            }
        }
        Ok(())
    }

    pub(super) async fn handle_mission(&self, request: &Request) -> Result<Value> {
        match request.method.as_str() {
            "missions.cleanup.list" => {
                let database = self.database.lock().await;
                let mut stmt=database.connection().prepare("SELECT mission_id FROM mission_workspace WHERE state IN ('cleanup_pending','cleanup_failed') AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id) ORDER BY updated_at")?;
                let ids = stmt
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let mut rows = Vec::new();
                for id in ids {
                    rows.extend(mission_workspace::load_workspaces(
                        database.connection(),
                        &id,
                    )?);
                }
                Ok(serde_json::to_value(rows)?)
            }
            "missions.cleanup.retry" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Retry {
                    workspace_id: String,
                }
                let query: Retry = serde_json::from_value(request.params.clone())?;
                let _guard = self.mission_workspace_gate.lock().await;
                let camp_id = {
                    let database = self.database.lock().await;
                    database.connection().query_row("SELECT camp_id FROM mission_workspace WHERE id=?1 AND state IN ('cleanup_pending','cleanup_failed') AND NOT EXISTS(SELECT 1 FROM camp WHERE camp.id=mission_workspace.camp_id)",[&query.workspace_id],|r|r.get::<_,String>(0)).optional()?
                };
                if let Some(camp_id) = camp_id {
                    self.cleanup_mission_workspaces_locked(Some(&camp_id))
                        .await?;
                }
                let database = self.database.lock().await;
                let pending = database.connection().query_row(
                    "SELECT EXISTS(SELECT 1 FROM mission_workspace WHERE id=?1)",
                    [&query.workspace_id],
                    |r| r.get::<_, bool>(0),
                )?;
                Ok(json!({"pending":pending}))
            }
            "missions.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MissionService::default().list(&database)?,
                )?)
            }
            "missions.get"
            | "missions.activity"
            | "missions.delivery"
            | "missions.changes"
            | "missions.fileDiff"
            | "missions.diffSession.release" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Query {
                    mission_id: String,
                    before: Option<i64>,
                    file_id: Option<String>,
                }
                let query: Query = serde_json::from_value(request.params.clone())?;
                if request.method == "missions.diffSession.release" {
                    {
                        let database = self.database.lock().await;
                        MissionService::default()
                            .get(&database, &query.mission_id)?
                            .context("mission.not_found")?;
                    }
                    let released = self
                        .mission_diff_snapshots
                        .lock()
                        .await
                        .release(&query.mission_id);
                    return Ok(json!({ "released": released }));
                }
                let (mission, workspaces) = {
                    let database = self.database.lock().await;
                    let mission = MissionService::default()
                        .get(&database, &query.mission_id)?
                        .context("mission.not_found")?;
                    if request.method == "missions.get" {
                        return Ok(serde_json::to_value(mission)?);
                    }
                    if request.method == "missions.activity" {
                        return Ok(serde_json::to_value(MissionService::default().activity(
                            &database,
                            &query.mission_id,
                            query.before,
                        )?)?);
                    }
                    let workspaces = mission_workspace::load_workspaces(
                        database.connection(),
                        &query.mission_id,
                    )?;
                    (mission, workspaces)
                };
                if request.method == "missions.delivery" {
                    let database = self.database.lock().await;
                    let mut prs=database.connection().prepare("SELECT id,url,title,created_at FROM mission_pr WHERE mission_id=?1 ORDER BY created_at DESC,id")?;
                    let prs=prs.query_map([&query.mission_id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"url":r.get::<_,String>(1)?,"title":r.get::<_,String>(2)?,"createdAt":r.get::<_,String>(3)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
                    let mut files=database.connection().prepare("SELECT a.id,r.display_name_snapshot,a.media_type,a.byte_size,a.preview_kind,m.id,m.author_id,m.created_at,a.kind,a.file_count FROM camp_message m JOIN camp_message_attachment_ref r ON r.camp_message_id=m.id JOIN managed_attachment a ON a.id=r.attachment_id AND a.camp_id=m.camp_id WHERE m.camp_id=?1 AND m.author_type='agent' AND m.tombstoned_at IS NULL AND a.state='available' ORDER BY m.sequence DESC,r.ordinal")?;
                    let files=files.query_map([&mission.camp_id],|r|Ok(json!({"attachmentId":r.get::<_,String>(0)?,"displayName":r.get::<_,String>(1)?,"mediaType":r.get::<_,String>(2)?,"byteSize":r.get::<_,i64>(3)?,"previewKind":r.get::<_,String>(4)?,"messageId":r.get::<_,String>(5)?,"agentId":r.get::<_,String>(6)?,"createdAt":r.get::<_,String>(7)?,"kind":r.get::<_,String>(8)?,"fileCount":r.get::<_,i64>(9)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
                    let git_project = !workspaces.is_empty()
                        || mission_workspace::has_git_marker(Path::new(&mission.project_path));
                    return Ok(
                        json!({"campId":mission.camp_id,"workingDirectory":workspaces.first().map(|w|w.working_directory.as_str()).unwrap_or(&mission.project_path),"git":git_project,"workspace":workspaces.first(),"pullRequests":prs,"files":files}),
                    );
                }
                let workspace = workspaces.first().context(
                    if mission_workspace::has_git_marker(Path::new(&mission.project_path)) {
                        "mission.workspace_not_prepared"
                    } else {
                        "mission.git_not_applicable"
                    },
                )?;
                let git = self.mission_git().await?;
                if request.method == "missions.changes" {
                    let snapshot = git.changes_snapshot(workspace).await?;
                    let files = snapshot.files().to_vec();
                    self.mission_diff_snapshots
                        .lock()
                        .await
                        .insert(query.mission_id, snapshot);
                    Ok(serde_json::to_value(files)?)
                } else {
                    let snapshot = self
                        .mission_diff_snapshots
                        .lock()
                        .await
                        .get(&query.mission_id, workspace)
                        .context("mission.changes_refresh_required")?;
                    Ok(serde_json::to_value(
                        git.file_diff(
                            workspace,
                            &snapshot,
                            query
                                .file_id
                                .as_deref()
                                .context("mission.file_id_required")?,
                        )
                        .await?,
                    )?)
                }
            }
            "missions.create" | "missions.createWithAttachments" => {
                let mut params: UserCommandParams<CreateMissionCommand> =
                    if request.method == "missions.createWithAttachments" {
                        anyhow::ensure!(request.client.is_desktop(), "mission.desktop_required");
                        let private: CreateMissionWithAttachmentsParams =
                            serde_json::from_value(request.params.clone())?;
                        let mut command = private.command;
                        command.source_attachments =
                            observe_mission_source_attachments(private.attachments).await?;
                        UserCommandParams {
                            command_id: private.command_id,
                            command,
                        }
                    } else {
                        serde_json::from_value(request.params.clone())?
                    };
                if params.command.project_binding_kind == ProjectBindingKind::QuickChat {
                    let path = self.data_dir.join("quick-chat");
                    std::fs::create_dir_all(&path)?;
                    params.command.project_path = path.to_string_lossy().into();
                }
                let selection = git::select_workspace(
                    Path::new(&params.command.project_path),
                    &self.data_dir,
                    params.command.project_binding_kind == ProjectBindingKind::QuickChat,
                )?;
                if !request.client.is_desktop() {
                    anyhow::ensure!(
                        selection.project_path == params.command.project_path,
                        "Authorized workspace changed before Mission creation"
                    );
                }
                params.command.project_path = selection.project_path;
                let mut database = self.database.lock().await;
                let execution = MissionService::default().create(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied
                    && let Some(camp_id) = execution.result.payload["campId"].as_str()
                {
                    self.attachment_views
                        .ensure_empty_camp_ready(&mut database, camp_id)?;
                }
                emit_navigation_invalidated(
                    &self.output,
                    "missions.create",
                    execution.result.payload["campId"].as_str(),
                );
                Ok(serde_json::to_value(execution.result)?)
            }
            "missions.update"
            | "missions.updateWithAttachments"
            | "missions.status"
            | "missions.start"
            | "missions.linkPr" => {
                let private_update = if request.method == "missions.updateWithAttachments" {
                    anyhow::ensure!(request.client.is_desktop(), "mission.desktop_required");
                    let private: UpdateMissionWithAttachmentsParams =
                        serde_json::from_value(request.params.clone())?;
                    let mut command = private.command;
                    command.source_attachment_update = Some(MissionAttachmentUpdate {
                        keep_attachment_ids: private.keep_attachment_ids,
                        new_source_attachments: observe_mission_source_attachments(
                            private.attachments,
                        )
                        .await?,
                    });
                    Some(UserCommandParams {
                        command_id: private.command_id,
                        command,
                    })
                } else {
                    None
                };
                let mut database = self.database.lock().await;
                let execution = match request.method.as_str() {
                    "missions.update" | "missions.updateWithAttachments" => {
                        let params: UserCommandParams<UpdateMissionCommand> = match private_update {
                            Some(params) => params,
                            None => serde_json::from_value(request.params.clone())?,
                        };
                        MissionService::default().update(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                    "missions.status" => {
                        let params: UserCommandParams<StatusMissionCommand> =
                            serde_json::from_value(request.params.clone())?;
                        MissionService::default().status(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                    "missions.linkPr" => {
                        let params: UserCommandParams<crate::mission::LinkMissionPrCommand> =
                            serde_json::from_value(request.params.clone())?;
                        MissionService::default().link_pr(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                    _ => {
                        let params: UserCommandParams<StartMissionCommand> =
                            serde_json::from_value(request.params.clone())?;
                        MissionService::default().start(
                            &mut database,
                            &user_command_envelope(params.command_id, params.command),
                        )?
                    }
                };
                if super::command_result_has_delivery_work(&execution.result.payload) {
                    self.delivery_batch_scheduler_notify.notify_one();
                }
                emit_navigation_invalidated(&self.output, &request.method, None);
                Ok(serde_json::to_value(execution.result)?)
            }
            _ => anyhow::bail!("Unsupported Mission operation"),
        }
    }
}

async fn select_candidate(
    git: &MissionGit,
    repository: &GitRepository,
    mission: &crate::mission::MissionRecord,
    host: &str,
    start: u32,
) -> Result<MissionWorkspace> {
    let parent = repository
        .root
        .parent()
        .context("mission.repository_parent_missing")?;
    let name = repository
        .root
        .file_name()
        .context("mission.repository_name_missing")?
        .to_str()
        .context("mission.invalid_path")?;
    for suffix in start..=10000 {
        let suffix = if suffix == 1 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let mission_number = format!("{:03}", mission.number);
        let branch = format!("rovai/mission/{mission_number}{suffix}");
        let path = parent.join(format!("{name}-mission-{mission_number}{suffix}"));
        if !git.candidate_available(repository, &path, &branch).await? {
            continue;
        }
        return Ok(MissionWorkspace {
            id: uuid::Uuid::new_v4().to_string(),
            mission_id: mission.info.mission_id.clone(),
            camp_id: mission.camp_id.clone(),
            execution_host_id: host.into(),
            source_directory: mission.project_path.clone(),
            repository_root: repository
                .root
                .to_str()
                .context("mission.invalid_path")?
                .into(),
            git_common_dir: repository
                .common_dir
                .to_str()
                .context("mission.invalid_path")?
                .into(),
            worktree_path: path.to_str().context("mission.invalid_path")?.into(),
            working_directory: path
                .join(&repository.relative_directory)
                .to_str()
                .context("mission.invalid_path")?
                .into(),
            base_branch: repository.base_branch.clone(),
            branch,
            base_sha: repository.base_sha.clone(),
            preparation_token: uuid::Uuid::new_v4().to_string(),
            state: "preparing".into(),
            diagnostic: None,
        });
    }
    anyhow::bail!("mission.workspace_names_exhausted")
}
