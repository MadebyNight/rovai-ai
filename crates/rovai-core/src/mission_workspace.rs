//! Core-owned persistent Mission worktrees and current net changes. No Agent-reported patches.
use crate::runtime_probe_process::{
    BoundedCommandOutput, ProbeCommandLimits, run_bounded_command_with_input,
};
use anyhow::{Context, Result, bail, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionWorkspace {
    pub id: String,
    pub mission_id: String,
    pub camp_id: String,
    pub execution_host_id: String,
    pub source_directory: String,
    pub repository_root: String,
    pub git_common_dir: String,
    pub worktree_path: String,
    pub working_directory: String,
    pub branch: String,
    pub base_sha: String,
    #[serde(skip)]
    pub preparation_token: String,
    pub state: String,
    pub diagnostic: Option<String>,
}
#[derive(Debug, Clone)]
pub struct GitRepository {
    pub root: PathBuf,
    pub common_dir: PathBuf,
    pub base_sha: String,
    pub relative_directory: PathBuf,
}
#[derive(Debug, Clone)]
pub struct MissionGit {
    executable: PathBuf,
}
impl MissionGit {
    pub fn new(executable: PathBuf) -> Result<Self> {
        ensure!(
            executable.is_absolute() && executable.is_file(),
            "mission.git_unavailable"
        );
        Ok(Self { executable })
    }
    async fn output(
        &self,
        cwd: &Path,
        args: &[OsString],
        index: Option<&Path>,
        input: Option<&[u8]>,
    ) -> Result<BoundedCommandOutput> {
        let mut command = Command::new(&self.executable);
        crate::runtime_discovery::configure_active_runtime_command(&mut command);
        for key in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_COMMON_DIR",
            "GIT_INDEX_FILE",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ] {
            command.env_remove(key);
        }
        command
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .arg("--no-optional-locks")
            .arg("--literal-pathspecs")
            .arg("-C")
            .arg(cwd)
            .args(args);
        if let Some(index) = index {
            command.env("GIT_INDEX_FILE", index);
        }
        let output = run_bounded_command_with_input(
            &mut command,
            input,
            ProbeCommandLimits {
                deadline: Duration::from_secs(120),
                stdout_bytes: 16 * 1024 * 1024,
                stderr_bytes: 64 * 1024,
                cleanup_timeout: Duration::from_secs(2),
            },
        )
        .await
        .context("mission.git_failed")?;
        ensure!(!output.stdout.truncated, "mission.git_output_too_large");
        Ok(output)
    }
    async fn bytes(&self, cwd: &Path, args: &[&str]) -> Result<Vec<u8>> {
        let output = self
            .output(
                cwd,
                &args.iter().map(OsString::from).collect::<Vec<_>>(),
                None,
                None,
            )
            .await?;
        ensure!(output.status.success(), "{}", output.stderr.lossy_text());
        Ok(output.stdout.bytes)
    }
    async fn text(&self, cwd: &Path, args: &[&str]) -> Result<String> {
        Ok(String::from_utf8(self.bytes(cwd, args).await?)
            .context("mission.invalid_git_text")?
            .trim_end_matches(['\r', '\n'])
            .to_string())
    }
    pub async fn inspect(&self, directory: &Path, source: &str) -> Result<Option<GitRepository>> {
        let output = self
            .output(
                directory,
                &["rev-parse".into(), "--is-inside-work-tree".into()],
                None,
                None,
            )
            .await?;
        if !output.status.success() {
            if output.stderr.lossy_text().contains("not a git repository")
                && !has_git_marker(directory)
            {
                return Ok(None);
            }
            bail!("mission.git_unavailable: {}", output.stderr.lossy_text());
        }
        ensure!(
            output.stdout.bytes.starts_with(b"true"),
            "mission.git_worktree_required"
        );
        let root = fs::canonicalize(
            self.text(directory, &["rev-parse", "--show-toplevel"])
                .await?,
        )?;
        let common_dir = fs::canonicalize(
            self.text(
                directory,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )
            .await?,
        )?;
        let base_sha = self
            .text(
                directory,
                &[
                    "rev-parse",
                    "--verify",
                    "--end-of-options",
                    &format!("{source}^{{commit}}"),
                ],
            )
            .await
            .context("mission.base_unavailable")?;
        let relative_directory = fs::canonicalize(directory)?
            .strip_prefix(&root)
            .context("mission.project_outside_repository")?
            .to_path_buf();
        Ok(Some(GitRepository {
            root,
            common_dir,
            base_sha,
            relative_directory,
        }))
    }
    pub async fn candidate_available(
        &self,
        repo: &GitRepository,
        path: &Path,
        branch: &str,
    ) -> Result<bool> {
        if path_occupied(path)? {
            return Ok(false);
        }
        let output = self
            .output(
                &repo.root,
                &[
                    "show-ref".into(),
                    "--verify".into(),
                    "--quiet".into(),
                    format!("refs/heads/{branch}").into(),
                ],
                None,
                None,
            )
            .await?;
        match output.status.code() {
            Some(0) => Ok(false),
            Some(1) => Ok(true),
            _ => bail!("mission.git_failed: {}", output.stderr.lossy_text()),
        }
    }
    fn staging_root(workspace: &MissionWorkspace) -> Result<PathBuf> {
        Ok(Path::new(&workspace.repository_root)
            .parent()
            .context("mission.repository_parent_missing")?
            .join(format!(
                ".rovai-mission-prepare-{}",
                workspace.preparation_token
            )))
    }
    fn verify_staging_owner(root: &Path, workspace: &MissionWorkspace) -> Result<()> {
        ensure!(
            !fs::symlink_metadata(root)?.file_type().is_symlink(),
            "mission.staging_owner_mismatch"
        );
        ensure!(
            fs::read_to_string(root.join("owner"))? == workspace.preparation_token,
            "mission.staging_owner_mismatch"
        );
        Ok(())
    }
    async fn admin_dir(&self, path: &Path) -> Result<PathBuf> {
        Ok(PathBuf::from(
            self.text(path, &["rev-parse", "--path-format=absolute", "--git-dir"])
                .await?,
        ))
    }
    async fn verify_tree(
        &self,
        path: &Path,
        workspace: &MissionWorkspace,
        require_marker: bool,
    ) -> Result<()> {
        ensure!(
            fs::canonicalize(path)? == path,
            "mission.worktree_path_changed"
        );
        ensure!(
            fs::canonicalize(self.text(path, &["rev-parse", "--show-toplevel"]).await?)? == path,
            "mission.worktree_root_mismatch"
        );
        ensure!(
            fs::canonicalize(
                self.text(
                    path,
                    &["rev-parse", "--path-format=absolute", "--git-common-dir"]
                )
                .await?
            )? == Path::new(&workspace.git_common_dir),
            "mission.repository_mismatch"
        );
        let admin = self.admin_dir(path).await?;
        ensure!(
            admin.starts_with(Path::new(&workspace.git_common_dir).join("worktrees")),
            "mission.worktree_registration_missing"
        );
        let registered = fs::read_to_string(admin.join("gitdir"))?;
        ensure!(
            fs::canonicalize(registered.trim_end_matches(['\r', '\n']))?
                == fs::canonicalize(path.join(".git"))?,
            "mission.worktree_registration_mismatch"
        );
        if require_marker {
            ensure!(
                fs::read_to_string(admin.join("rovai-mission-owner"))?
                    == workspace.preparation_token,
                "mission.worktree_owner_mismatch"
            );
        }
        Ok(())
    }
    /// A private staging parent proves ownership even across interruption before worktree registration.
    /// The final worktree carries that proof in Git's admin directory, outside tracked files.
    pub async fn materialize(&self, workspace: &MissionWorkspace) -> Result<()> {
        let target = Path::new(&workspace.worktree_path);
        if path_occupied(target)? {
            if self.verify_tree(target, workspace, true).await.is_ok() {
                self.remove_empty_staging(workspace)?;
                return Ok(());
            }
            return Err(NameOccupied.into());
        }
        let staging = Self::staging_root(workspace)?;
        if staging.exists() {
            Self::verify_staging_owner(&staging, workspace)?;
        } else {
            fs::create_dir(&staging)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))?;
            }
            fs::write(staging.join("owner"), &workspace.preparation_token)?;
        }
        let checkout = staging.join("checkout");
        if !checkout.exists() {
            let output = self
                .output(
                    Path::new(&workspace.repository_root),
                    &[
                        "worktree".into(),
                        "add".into(),
                        "--no-guess-remote".into(),
                        "-b".into(),
                        workspace.branch.clone().into(),
                        checkout.as_os_str().to_owned(),
                        workspace.base_sha.clone().into(),
                    ],
                    None,
                    None,
                )
                .await?;
            if !output.status.success() {
                let error = output.stderr.lossy_text();
                if error.contains("already exists")
                    && (error.contains("branch named")
                        || error.contains("reference already exists"))
                {
                    return Err(NameOccupied.into());
                }
                bail!("mission.worktree_create_failed: {error}");
            }
        }
        self.verify_tree(&checkout, workspace, false).await?;
        ensure!(
            self.text(&checkout, &["symbolic-ref", "--short", "HEAD"])
                .await?
                == workspace.branch,
            "mission.preparing_branch_mismatch"
        );
        let admin = self.admin_dir(&checkout).await?;
        let owner_path = admin.join("rovai-mission-owner");
        if owner_path.exists() {
            ensure!(
                fs::read_to_string(&owner_path)? == workspace.preparation_token,
                "mission.worktree_owner_mismatch"
            );
        } else {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&owner_path)?;
            file.write_all(workspace.preparation_token.as_bytes())?;
            file.sync_all()?;
        }
        let output = self
            .output(
                Path::new(&workspace.repository_root),
                &[
                    "worktree".into(),
                    "move".into(),
                    checkout.into_os_string(),
                    target.as_os_str().to_owned(),
                ],
                None,
                None,
            )
            .await?;
        if !output.status.success() {
            let error = output.stderr.lossy_text();
            if path_occupied(target)?
                && (error.contains("already exists") || error.contains("not empty"))
            {
                return Err(NameOccupied.into());
            }
            bail!("mission.worktree_move_failed: {error}");
        }
        self.verify_tree(target, workspace, true).await?;
        Self::verify_staging_owner(&staging, workspace)?;
        fs::remove_file(staging.join("owner"))?;
        fs::remove_dir(&staging)?;
        Ok(())
    }
    fn remove_empty_staging(&self, workspace: &MissionWorkspace) -> Result<()> {
        let staging = Self::staging_root(workspace)?;
        if path_occupied(&staging)? {
            Self::verify_staging_owner(&staging, workspace)?;
            ensure!(
                !path_occupied(&staging.join("checkout"))?,
                "mission.preparing_checkout_remains"
            );
            fs::remove_file(staging.join("owner"))?;
            fs::remove_dir(staging)?;
        }
        Ok(())
    }
    pub async fn abandon_candidate(&self, workspace: &MissionWorkspace) -> Result<()> {
        let staging = Self::staging_root(workspace)?;
        if path_occupied(&staging)? {
            Self::verify_staging_owner(&staging, workspace)?;
            let checkout = staging.join("checkout");
            if path_occupied(&checkout)? {
                self.verify_tree(&checkout, workspace, false).await?;
                self.bytes(
                    Path::new(&workspace.repository_root),
                    &[
                        "worktree",
                        "remove",
                        "--force",
                        checkout.to_str().context("mission.invalid_path")?,
                    ],
                )
                .await?;
            }
            self.remove_empty_staging(workspace)?;
        }
        Ok(())
    }
    pub async fn validate(&self, workspace: &MissionWorkspace) -> Result<()> {
        ensure!(workspace.state == "ready", "mission.workspace_not_ready");
        self.verify_tree(Path::new(&workspace.worktree_path), workspace, true)
            .await?;
        self.bytes(
            Path::new(&workspace.worktree_path),
            &[
                "cat-file",
                "-e",
                &format!("{}^{{commit}}", workspace.base_sha),
            ],
        )
        .await
        .context("mission.base_unavailable")?;
        ensure!(
            fs::canonicalize(&workspace.working_directory)?
                == Path::new(&workspace.working_directory),
            "mission.working_directory_changed"
        );
        Ok(())
    }
    pub async fn current_branch(&self, workspace: &MissionWorkspace) -> Result<Option<String>> {
        let output = self
            .output(
                Path::new(&workspace.worktree_path),
                &[
                    "symbolic-ref".into(),
                    "--quiet".into(),
                    "--short".into(),
                    "HEAD".into(),
                ],
                None,
                None,
            )
            .await?;
        match output.status.code() {
            Some(0) => Ok(Some(
                String::from_utf8(output.stdout.bytes)?
                    .trim_end_matches(['\r', '\n'])
                    .into(),
            )),
            Some(1) => Ok(None),
            _ => bail!("mission.branch_unavailable"),
        }
    }
    pub async fn cleanup(&self, workspace: &MissionWorkspace) -> Result<()> {
        let target = Path::new(&workspace.worktree_path);
        if path_occupied(target)? {
            self.verify_tree(target, workspace, true).await?;
            self.bytes(
                Path::new(&workspace.repository_root),
                &["worktree", "remove", "--force", &workspace.worktree_path],
            )
            .await?;
        } else {
            // Prune only the exact registered worktree after proving its owner. Never run global prune.
            let registrations = Path::new(&workspace.git_common_dir).join("worktrees");
            if path_occupied(&registrations)? {
                ensure!(
                    fs::canonicalize(&registrations)? == registrations,
                    "mission.cleanup_registration_mismatch"
                );
                for entry in fs::read_dir(&registrations)? {
                    let entry = entry?;
                    ensure!(
                        !entry.file_type()?.is_symlink(),
                        "mission.cleanup_registration_mismatch"
                    );
                    let marker = entry.path().join("rovai-mission-owner");
                    if !path_occupied(&marker)? {
                        continue;
                    }
                    if fs::read_to_string(&marker)? != workspace.preparation_token {
                        continue;
                    }
                    let registered = fs::read_to_string(entry.path().join("gitdir"))?;
                    ensure!(
                        Path::new(registered.trim_end_matches(['\r', '\n'])) == target.join(".git"),
                        "mission.cleanup_registration_mismatch"
                    );
                    fs::remove_dir_all(entry.path())?;
                }
            }
        }
        let staging = Self::staging_root(workspace)?;
        if staging.exists() {
            Self::verify_staging_owner(&staging, workspace)?;
            let checkout = staging.join("checkout");
            if checkout.exists() {
                self.verify_tree(&checkout, workspace, false).await?;
                self.bytes(
                    Path::new(&workspace.repository_root),
                    &[
                        "worktree",
                        "remove",
                        "--force",
                        checkout.to_str().context("mission.invalid_path")?,
                    ],
                )
                .await?;
            }
            fs::remove_file(staging.join("owner"))?;
            fs::remove_dir(staging)?;
        }
        Ok(())
    }

    async fn temporary_index(&self, workspace: &MissionWorkspace) -> Result<TemporaryIndex> {
        let temporary = TemporaryIndex::new()?;
        let cwd = Path::new(&workspace.worktree_path);
        let real = self
            .text(
                cwd,
                &["rev-parse", "--path-format=absolute", "--git-path", "index"],
            )
            .await?;
        if Path::new(&real).exists() {
            fs::copy(&real, &temporary.index)?;
            let shared = self
                .text(cwd, &["rev-parse", "--shared-index-path"])
                .await?;
            if !shared.is_empty() {
                let shared = if Path::new(&shared).is_absolute() {
                    PathBuf::from(shared)
                } else {
                    cwd.join(shared)
                };
                fs::copy(
                    &shared,
                    temporary
                        .root
                        .join(shared.file_name().context("mission.invalid_shared_index")?),
                )?;
            }
        } else {
            let output = self
                .output(
                    cwd,
                    &["read-tree".into(), "--empty".into()],
                    Some(&temporary.index),
                    None,
                )
                .await?;
            ensure!(output.status.success(), "mission.temporary_index_failed");
        }
        let expanded = self
            .output(
                cwd,
                &["update-index".into(), "--no-split-index".into()],
                Some(&temporary.index),
                None,
            )
            .await?;
        ensure!(
            expanded.status.success(),
            "mission.temporary_index_failed: {}",
            expanded.stderr.lossy_text()
        );
        let untracked = self
            .bytes(cwd, &["ls-files", "--others", "--exclude-standard", "-z"])
            .await?;
        if !untracked.is_empty() {
            let output = self
                .output(
                    cwd,
                    &[
                        "add".into(),
                        "--intent-to-add".into(),
                        "--pathspec-from-file=-".into(),
                        "--pathspec-file-nul".into(),
                    ],
                    Some(&temporary.index),
                    Some(&untracked),
                )
                .await?;
            ensure!(
                output.status.success(),
                "mission.untracked_index_failed: {}",
                output.stderr.lossy_text()
            );
        }
        Ok(temporary)
    }
    async fn changes_with_index(
        &self,
        workspace: &MissionWorkspace,
        index: &Path,
    ) -> Result<Vec<MissionChangedFile>> {
        let output = self
            .output(
                Path::new(&workspace.worktree_path),
                &[
                    "diff".into(),
                    "--no-ext-diff".into(),
                    "--no-textconv".into(),
                    "--find-renames".into(),
                    "--raw".into(),
                    "--numstat".into(),
                    "--no-abbrev".into(),
                    "-z".into(),
                    workspace.base_sha.clone().into(),
                    "--".into(),
                ],
                Some(index),
                None,
            )
            .await?;
        ensure!(
            output.status.success(),
            "mission.diff_failed: {}",
            output.stderr.lossy_text()
        );
        parse_changes(&output.stdout.bytes)
    }
    pub async fn changes(&self, workspace: &MissionWorkspace) -> Result<Vec<MissionChangedFile>> {
        self.validate(workspace).await?;
        let temporary = self.temporary_index(workspace).await?;
        self.changes_with_index(workspace, &temporary.index).await
    }
    pub async fn file_diff(
        &self,
        workspace: &MissionWorkspace,
        file_id: &str,
    ) -> Result<MissionFileDiff> {
        self.validate(workspace).await?;
        let temporary = self.temporary_index(workspace).await?;
        let files = self.changes_with_index(workspace, &temporary.index).await?;
        let file = files
            .into_iter()
            .find(|file| file.id == file_id)
            .context("mission.file_no_longer_changed")?;
        if file.binary {
            return Ok(MissionFileDiff {
                file,
                patch: String::new(),
                hunks: Vec::new(),
            });
        }
        let mut args = vec![
            "diff".into(),
            "--no-ext-diff".into(),
            "--no-textconv".into(),
            "--find-renames".into(),
            "--unified=3".into(),
            workspace.base_sha.clone().into(),
            "--".into(),
        ];
        for path in &file.raw_paths {
            args.push(path_os_string(path)?);
        }
        let output = self
            .output(
                Path::new(&workspace.worktree_path),
                &args,
                Some(&temporary.index),
                None,
            )
            .await?;
        ensure!(
            output.status.success(),
            "mission.diff_failed: {}",
            output.stderr.lossy_text()
        );
        let patch = String::from_utf8(output.stdout.bytes).context("mission.diff_not_utf8")?;
        let hunks = parse_hunks(&patch)?;
        Ok(MissionFileDiff { file, patch, hunks })
    }
}

#[derive(Debug)]
pub struct NameOccupied;
impl std::fmt::Display for NameOccupied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("mission.workspace_name_occupied")
    }
}
impl std::error::Error for NameOccupied {}
fn path_occupied(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub fn has_git_marker(path: &Path) -> bool {
    path.ancestors().any(|p| {
        fs::symlink_metadata(p.join(".git")).is_ok()
            || (p.join("HEAD").is_file() && p.join("objects").is_dir())
    })
}
pub fn load_workspaces(connection: &Connection, mission_id: &str) -> Result<Vec<MissionWorkspace>> {
    let mut stmt=connection.prepare("SELECT id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,branch,base_sha,preparation_token,state,diagnostic FROM mission_workspace WHERE mission_id=?1 ORDER BY created_at,id")?;
    Ok(stmt
        .query_map([mission_id], |r| {
            Ok(MissionWorkspace {
                id: r.get(0)?,
                mission_id: r.get(1)?,
                camp_id: r.get(2)?,
                execution_host_id: r.get(3)?,
                source_directory: r.get(4)?,
                repository_root: r.get(5)?,
                git_common_dir: r.get(6)?,
                worktree_path: r.get(7)?,
                working_directory: r.get(8)?,
                branch: r.get(9)?,
                base_sha: r.get(10)?,
                preparation_token: r.get(11)?,
                state: r.get(12)?,
                diagnostic: r.get(13)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}
pub fn persist_plan(connection: &Connection, workspace: &MissionWorkspace) -> Result<()> {
    connection.execute("INSERT INTO mission_workspace(id,mission_id,camp_id,execution_host_id,source_directory,repository_root,git_common_dir,worktree_path,working_directory,branch,base_sha,preparation_token,state,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'preparing',?13,?13)",params![workspace.id,workspace.mission_id,workspace.camp_id,workspace.execution_host_id,workspace.source_directory,workspace.repository_root,workspace.git_common_dir,workspace.worktree_path,workspace.working_directory,workspace.branch,workspace.base_sha,workspace.preparation_token,chrono::Utc::now().to_rfc3339()])?;
    Ok(())
}
pub fn execution_directory(connection: &Connection, camp_id: &str) -> Result<Option<String>> {
    Ok(connection.query_row("SELECT w.working_directory FROM mission_workspace w JOIN mission m ON m.id=w.mission_id WHERE m.camp_id=?1 AND w.state='ready' ORDER BY w.created_at LIMIT 1",[camp_id],|r|r.get(0)).optional()?)
}

struct TemporaryIndex {
    root: PathBuf,
    index: PathBuf,
}
impl TemporaryIndex {
    fn new() -> Result<Self> {
        let root = std::env::temp_dir().join(format!("rovai-mission-index-{}", Uuid::new_v4()));
        fs::create_dir(&root)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        }
        Ok(Self {
            index: root.join("index"),
            root,
        })
    }
}
impl Drop for TemporaryIndex {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionChangedFile {
    pub id: String,
    pub path: String,
    pub old_path: Option<String>,
    pub kind: String,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub binary: bool,
    pub old_mode: String,
    pub new_mode: String,
    #[serde(skip)]
    raw_paths: Vec<Vec<u8>>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionFileDiff {
    pub file: MissionChangedFile,
    pub patch: String,
    pub hunks: Vec<DiffHunk>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u64,
    pub new_start: u64,
    pub lines: Vec<DiffLine>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,
    pub text: String,
    pub old_line: Option<u64>,
    pub new_line: Option<u64>,
}

fn parse_changes(bytes: &[u8]) -> Result<Vec<MissionChangedFile>> {
    let tokens = bytes.split(|b| *b == 0).collect::<Vec<_>>();
    let mut i = 0;
    let mut files = Vec::new();
    let mut indices = BTreeMap::new();
    while i < tokens.len() && tokens[i].starts_with(b":") {
        let fields = std::str::from_utf8(&tokens[i][1..])?
            .split_whitespace()
            .collect::<Vec<_>>();
        ensure!(fields.len() == 5, "mission.invalid_raw_diff");
        i += 1;
        let first = tokens.get(i).context("mission.invalid_raw_path")?.to_vec();
        i += 1;
        let (path, old_path, raw_paths) = if fields[4].starts_with(['R', 'C']) {
            let next = tokens.get(i).context("mission.invalid_rename")?.to_vec();
            i += 1;
            (
                next.clone(),
                Some(String::from_utf8_lossy(&first).into_owned()),
                vec![first, next],
            )
        } else {
            (first.clone(), None, vec![first])
        };
        let id = format!("{:x}", Sha256::digest(&path));
        let kind = match fields[4].as_bytes()[0] {
            b'A' => "added",
            b'D' => "deleted",
            b'R' => "renamed",
            b'C' => "copied",
            b'T' => "type_changed",
            b'U' => "unmerged",
            _ => "modified",
        };
        indices.insert(path.clone(), files.len());
        files.push(MissionChangedFile {
            id,
            path: String::from_utf8_lossy(&path).into_owned(),
            old_path,
            kind: kind.into(),
            additions: Some(0),
            deletions: Some(0),
            binary: false,
            old_mode: fields[0].into(),
            new_mode: fields[1].into(),
            raw_paths,
        });
    }
    while i < tokens.len() && !tokens[i].is_empty() {
        let fields = tokens[i].splitn(3, |b| *b == b'\t').collect::<Vec<_>>();
        ensure!(fields.len() == 3, "mission.invalid_numstat");
        i += 1;
        let path = if fields[2].is_empty() {
            let next = tokens
                .get(i + 1)
                .context("mission.invalid_numstat_rename")?;
            i += 2;
            *next
        } else {
            fields[2]
        };
        let file = &mut files[*indices
            .get(path)
            .context("mission.diff_changed_during_query")?];
        file.binary = fields[0] == b"-" || fields[1] == b"-";
        file.additions = if file.binary {
            None
        } else {
            Some(std::str::from_utf8(fields[0])?.parse()?)
        };
        file.deletions = if file.binary {
            None
        } else {
            Some(std::str::from_utf8(fields[1])?.parse()?)
        };
    }
    Ok(files)
}
fn path_os_string(bytes: &[u8]) -> Result<OsString> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(OsString::from_vec(bytes.to_vec()))
    }
    #[cfg(not(unix))]
    {
        Ok(OsString::from(std::str::from_utf8(bytes)?))
    }
}
fn parse_hunks(patch: &str) -> Result<Vec<DiffHunk>> {
    let mut hunks = Vec::<DiffHunk>::new();
    let mut old = 0;
    let mut new = 0;
    for line in patch.lines() {
        if line.starts_with("@@ ") {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            ensure!(fields.len() >= 4, "mission.invalid_diff_hunk");
            old = fields[1]
                .trim_start_matches('-')
                .split(',')
                .next()
                .context("mission.invalid_diff_hunk")?
                .parse()?;
            new = fields[2]
                .trim_start_matches('+')
                .split(',')
                .next()
                .context("mission.invalid_diff_hunk")?
                .parse()?;
            hunks.push(DiffHunk {
                old_start: old,
                new_start: new,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = hunks.last_mut() {
            let (kind, old_line, new_line) = match line.as_bytes().first() {
                Some(b'+') => {
                    let n = new;
                    new += 1;
                    ("addition", None, Some(n))
                }
                Some(b'-') => {
                    let n = old;
                    old += 1;
                    ("deletion", Some(n), None)
                }
                Some(b' ') => {
                    let o = old;
                    let n = new;
                    old += 1;
                    new += 1;
                    ("context", Some(o), Some(n))
                }
                Some(b'\\') => ("metadata", None, None),
                _ => continue,
            };
            hunk.lines.push(DiffLine {
                kind: kind.into(),
                text: line[1..].to_string(),
                old_line,
                new_line,
            });
        }
    }
    Ok(hunks)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    async fn fixture() -> (Fixture, MissionGit, GitRepository, MissionWorkspace) {
        let git = MissionGit::new(
            crate::runtime_discovery::resolve_active_command_path("git")
                .expect("Git required for real worktree test"),
        )
        .unwrap();
        let root = std::env::temp_dir().join(format!("rovai-mission-git-test-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let repo = root.join("app");
        fs::create_dir(&repo).unwrap();
        git.bytes(&repo, &["init", "-b", "main"]).await.unwrap();
        git.bytes(&repo, &["config", "user.name", "Mission Test"])
            .await
            .unwrap();
        git.bytes(&repo, &["config", "user.email", "mission@example.invalid"])
            .await
            .unwrap();
        for (name, body) in [
            ("edit.txt", "original\n"),
            ("remove.txt", "remove\n"),
            ("rename.txt", "stable rename\n"),
            ("mode.sh", "echo test\n"),
            (".gitignore", "ignored/\n"),
        ] {
            fs::write(repo.join(name), body).unwrap();
        }
        fs::create_dir(repo.join("src")).unwrap();
        fs::write(repo.join("src/keep.txt"), "keep\n").unwrap();
        git.bytes(&repo, &["add", "."]).await.unwrap();
        git.bytes(&repo, &["commit", "-m", "base"]).await.unwrap();
        let repository = git
            .inspect(&repo.join("src"), "HEAD")
            .await
            .unwrap()
            .unwrap();
        let path = root.join("app-mission-rvm_test");
        let workspace = MissionWorkspace {
            id: "ws".into(),
            mission_id: "rvm_test".into(),
            camp_id: "camp".into(),
            execution_host_id: "host".into(),
            source_directory: repo.join("src").to_str().unwrap().into(),
            repository_root: repo.to_str().unwrap().into(),
            git_common_dir: repository.common_dir.to_str().unwrap().into(),
            worktree_path: path.to_str().unwrap().into(),
            working_directory: path.join("src").to_str().unwrap().into(),
            branch: "rovai/mission/rvm_test".into(),
            base_sha: repository.base_sha.clone(),
            preparation_token: Uuid::new_v4().to_string(),
            state: "preparing".into(),
            diagnostic: None,
        };
        (Fixture(root), git, repository, workspace)
    }
    #[tokio::test]
    async fn persistent_worktree_preserves_source_recovers_owned_creation_and_retains_branch_on_delete()
     {
        let (_fixture, git, repo, mut workspace) = fixture().await;
        fs::write(repo.root.join("edit.txt"), "source dirty\n").unwrap();
        assert!(
            git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        fs::create_dir(&workspace.worktree_path).unwrap();
        fs::write(
            Path::new(&workspace.worktree_path).join("unrelated"),
            "preserve",
        )
        .unwrap();
        assert!(
            !git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        assert!(
            git.materialize(&workspace)
                .await
                .unwrap_err()
                .is::<NameOccupied>()
        );
        assert_eq!(
            fs::read_to_string(Path::new(&workspace.worktree_path).join("unrelated")).unwrap(),
            "preserve"
        );
        fs::remove_dir_all(&workspace.worktree_path).unwrap();
        // Simulate interruption after Git registered the tree, before Core wrote the admin marker.
        let staging = MissionGit::staging_root(&workspace).unwrap();
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("owner"), &workspace.preparation_token).unwrap();
        git.bytes(
            &repo.root,
            &[
                "worktree",
                "add",
                "-b",
                &workspace.branch,
                staging.join("checkout").to_str().unwrap(),
                &workspace.base_sha,
            ],
        )
        .await
        .unwrap();
        git.materialize(&workspace).await.unwrap();
        workspace.state = "ready".into();
        git.validate(&workspace).await.unwrap();
        git.materialize(&workspace).await.unwrap();
        assert_eq!(
            fs::read_to_string(Path::new(&workspace.worktree_path).join("edit.txt")).unwrap(),
            "original\n"
        );
        assert_eq!(
            fs::read_to_string(repo.root.join("edit.txt")).unwrap(),
            "source dirty\n"
        );
        git.bytes(
            Path::new(&workspace.worktree_path),
            &["checkout", "--detach"],
        )
        .await
        .unwrap();
        assert_eq!(git.current_branch(&workspace).await.unwrap(), None);
        git.validate(&workspace).await.unwrap();
        git.cleanup(&workspace).await.unwrap();
        assert!(!Path::new(&workspace.worktree_path).exists());
        assert!(
            !git.candidate_available(
                &repo,
                Path::new(&workspace.worktree_path),
                &workspace.branch
            )
            .await
            .unwrap()
        );
        git.cleanup(&workspace).await.unwrap();
        assert!(git.validate(&workspace).await.is_err());
        let non_git = repo.root.parent().unwrap().join("plain");
        fs::create_dir(&non_git).unwrap();
        assert!(git.inspect(&non_git, "HEAD").await.unwrap().is_none());
    }
    #[tokio::test]
    async fn fixed_base_diff_is_final_net_content_without_mutating_real_index() {
        let (_fixture, git, _repo, mut workspace) = fixture().await;
        git.materialize(&workspace).await.unwrap();
        workspace.state = "ready".into();
        let cwd = Path::new(&workspace.worktree_path);
        fs::write(cwd.join("edit.txt"), "committed\n").unwrap();
        git.bytes(cwd, &["add", "edit.txt"]).await.unwrap();
        git.bytes(cwd, &["commit", "-m", "mission commit"])
            .await
            .unwrap();
        fs::write(cwd.join("edit.txt"), "staged\n").unwrap();
        git.bytes(cwd, &["add", "edit.txt"]).await.unwrap();
        fs::write(cwd.join("edit.txt"), "final\n").unwrap();
        git.bytes(cwd, &["mv", "rename.txt", "renamed.txt"])
            .await
            .unwrap();
        fs::remove_file(cwd.join("remove.txt")).unwrap();
        for (name, body) in [
            ("new.txt", b"new\n".as_slice()),
            ("tab\t中文\nfile", b"special\n"),
            ("empty", b""),
            ("binary", b"a\0b"),
        ] {
            fs::write(cwd.join(name), body).unwrap();
        }
        fs::create_dir(cwd.join("ignored")).unwrap();
        fs::write(cwd.join("ignored/hidden"), "ignore").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(cwd.join("mode.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        git.bytes(cwd, &["update-index", "--split-index"])
            .await
            .unwrap();
        let index = git
            .text(
                cwd,
                &["rev-parse", "--path-format=absolute", "--git-path", "index"],
            )
            .await
            .unwrap();
        let before = fs::read(&index).unwrap();
        let head = git.text(cwd, &["rev-parse", "HEAD"]).await.unwrap();
        let files = git.changes(&workspace).await.unwrap();
        for name in [
            "edit.txt",
            "renamed.txt",
            "remove.txt",
            "new.txt",
            "tab\t中文\nfile",
            "empty",
            "binary",
        ] {
            assert!(
                files.iter().any(|f| f.path == name),
                "missing {name}: {files:?}"
            );
        }
        assert!(files.iter().all(|f| !f.path.starts_with("ignored/")));
        assert!(files.iter().find(|f| f.path == "binary").unwrap().binary);
        assert_eq!(
            files
                .iter()
                .find(|f| f.path == "renamed.txt")
                .unwrap()
                .old_path
                .as_deref(),
            Some("rename.txt")
        );
        let edit = files.iter().find(|f| f.path == "edit.txt").unwrap();
        assert_eq!((edit.additions, edit.deletions), (Some(1), Some(1)));
        let diff = git.file_diff(&workspace, &edit.id).await.unwrap();
        assert!(diff.patch.contains("-original\n+final"));
        assert!(!diff.patch.contains("staged"));
        assert_eq!(diff.hunks[0].lines[0].old_line, Some(1));
        assert_eq!(fs::read(&index).unwrap(), before);
        assert_eq!(git.text(cwd, &["rev-parse", "HEAD"]).await.unwrap(), head);
        fs::write(cwd.join("edit.txt"), "original\n").unwrap();
        assert!(
            !git.changes(&workspace)
                .await
                .unwrap()
                .iter()
                .any(|f| f.path == "edit.txt")
        );
        assert!(git.file_diff(&workspace, &edit.id).await.is_err());
        git.cleanup(&workspace).await.unwrap();
    }
}
