//! Read-only discovery of Skills in the executing Host's native Harness paths.
//! Discovery neither projects Rovai content into a project nor mutates a
//! Harness configuration. A cache entry is only a candidate view, never an
//! authority for a frozen message or a Runtime's actual loaded state.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, ensure};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::agent_profile::AdapterKind;
use crate::command::{
    ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
    DomainCommandGateway, sealed,
};
use crate::db::Database;
use crate::runtime_startup::RuntimeStartupConfiguration;

const CONTEXT_CACHE_CAPACITY: usize = 32;
const CONTEXT_CACHE_TTL: Duration = Duration::from_secs(60);
const MAX_SKILLS_PER_ROOT: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub entry_path: String,
    pub canonical_path: String,
    pub source_scope: String,
    pub adapter_kind: AdapterKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSkillScan {
    pub skills: Vec<NativeSkill>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RememberNativeSkillReferencesCommand {
    pub skills: Vec<NativeSkill>,
}

impl sealed::Sealed for RememberNativeSkillReferencesCommand {}
impl DomainCommand for RememberNativeSkillReferencesCommand {
    const TYPE: &'static str = "native_skill.references.remember";
}

pub fn remember_native_skill_references(
    database: &mut Database,
    skills: &[NativeSkill],
) -> Result<CommandExecution> {
    let envelope = CommandEnvelope {
        command_id: Uuid::new_v4().to_string(),
        actor: ActorRef::System {
            component_id: "native_skill_discovery".to_string(),
        },
        camp_id: None,
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload: RememberNativeSkillReferencesCommand {
            skills: skills.to_vec(),
        },
    };
    DomainCommandGateway.execute(database, &envelope, |transaction| {
        let now = chrono::Utc::now().to_rfc3339();
        for skill in &envelope.payload.skills {
            let adapter_kind = serde_json::to_value(skill.adapter_kind)?;
            transaction.execute(
                "INSERT INTO native_skill_reference(id, name, entry_path, canonical_path, source_scope, adapter_kind, discovered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name, entry_path=excluded.entry_path, canonical_path=excluded.canonical_path, source_scope=excluded.source_scope, adapter_kind=excluded.adapter_kind, discovered_at=excluded.discovered_at",
                params![skill.id, skill.name, skill.entry_path, skill.canonical_path, skill.source_scope, adapter_kind.as_str(), now],
            )?;
        }
        Ok(CommandHandlerResult::applied(
            "native_skill.references.remembered",
            serde_json::json!({"count": envelope.payload.skills.len()}),
            None,
        ))
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CacheKey {
    adapter: AdapterKind,
    home: PathBuf,
    project: Option<PathBuf>,
    user_only: bool,
    roots: Vec<(&'static str, PathBuf)>,
    native_config_digest: String,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    key: CacheKey,
    value: NativeSkillScan,
    scanned_at: Instant,
}

#[derive(Default)]
pub struct NativeSkillDiscovery {
    cache: Mutex<VecDeque<CacheEntry>>,
}

impl NativeSkillDiscovery {
    pub fn invalidate_cache(&self) {
        if let Ok(mut entries) = self.cache.lock() {
            entries.clear();
        }
    }

    pub fn discover(
        &self,
        adapter: AdapterKind,
        project: Option<&Path>,
        user_only: bool,
        refresh: bool,
        configuration: &RuntimeStartupConfiguration,
    ) -> Result<NativeSkillScan> {
        let home = runtime_variable(
            configuration,
            if cfg!(windows) { "USERPROFILE" } else { "HOME" },
        )
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .context("executing Host home directory is unavailable")?;
        ensure!(
            home.is_absolute(),
            "executing Host home directory is not absolute"
        );
        let project =
            project.map(|path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf()));
        if let Some(project) = &project {
            ensure!(project.is_absolute(), "project path is not absolute");
        }
        let mut roots = user_roots(adapter, &home, configuration);
        if !user_only {
            if let Some(project) = &project {
                roots.extend(project_roots(adapter, project));
            }
        }
        let (disabled_paths, disabled_names, config_errors, native_config_digest) =
            codex_disabled_skill_folders(adapter, &home, project.as_deref(), configuration);
        let key = CacheKey {
            adapter,
            home: home.clone(),
            project: project.clone(),
            user_only,
            roots: roots.clone(),
            native_config_digest,
        };
        if !refresh {
            if let Ok(mut entries) = self.cache.lock() {
                if let Some(index) = entries.iter().position(|entry| entry.key == key) {
                    let entry = entries.remove(index).expect("cached index exists");
                    if entry.scanned_at.elapsed() < CONTEXT_CACHE_TTL {
                        let value = entry.value.clone();
                        entries.push_back(entry);
                        return Ok(value);
                    }
                }
            }
        }
        let mut scan = NativeSkillScan {
            skills: Vec::new(),
            errors: config_errors,
        };
        let mut seen_roots = HashSet::new();
        let mut seen_files = HashSet::new();
        for (scope, root) in roots {
            let normalized = root.canonicalize().unwrap_or(root.clone());
            if !seen_roots.insert((scope, normalized)) {
                continue;
            }
            scan_root(adapter, scope, &root, &mut seen_files, &mut scan);
        }
        scan.skills.retain(|skill| {
            let path = Path::new(&skill.canonical_path);
            !disabled_names.contains(&skill.name)
                && !disabled_paths.contains(path)
                && path
                    .parent()
                    .is_none_or(|folder| !disabled_paths.contains(folder))
        });
        scan.skills.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.source_scope.cmp(&right.source_scope))
                .then_with(|| left.entry_path.cmp(&right.entry_path))
        });
        if let Ok(mut entries) = self.cache.lock() {
            if let Some(index) = entries.iter().position(|entry| entry.key == key) {
                entries.remove(index);
            }
            entries.push_back(CacheEntry {
                key,
                value: scan.clone(),
                scanned_at: Instant::now(),
            });
            while entries.len() > CONTEXT_CACHE_CAPACITY {
                entries.pop_front();
            }
        }
        Ok(scan)
    }
}

fn codex_disabled_skill_folders(
    adapter: AdapterKind,
    home: &Path,
    project: Option<&Path>,
    configuration: &RuntimeStartupConfiguration,
) -> (HashSet<PathBuf>, HashSet<String>, Vec<String>, String) {
    if adapter != AdapterKind::CodexCli {
        return (HashSet::new(), HashSet::new(), Vec::new(), String::new());
    }
    let mut paths =
        vec![configured_root("CODEX_HOME", home.join(".codex"), configuration).join("config.toml")];
    if let Some(project) = project {
        paths.push(project.join(".codex/config.toml"));
    }
    let mut path_state = HashMap::<PathBuf, bool>::new();
    let mut name_state = HashMap::<String, bool>::new();
    let mut errors = Vec::new();
    let mut digest = Sha256::new();
    for config_path in paths {
        digest.update(config_path.to_string_lossy().as_bytes());
        let contents = match fs::read_to_string(&config_path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(format!("{}: {error}", config_path.display()));
                continue;
            }
        };
        digest.update(contents.as_bytes());
        let config: toml::Value = match toml::from_str(&contents) {
            Ok(value) => value,
            Err(error) => {
                errors.push(format!("{}: {error}", config_path.display()));
                continue;
            }
        };
        let Some(entries) = config.get("skills").and_then(|skills| skills.get("config")) else {
            continue;
        };
        let Some(entries) = entries.as_array() else {
            errors.push(format!(
                "{}: skills.config is not an array",
                config_path.display()
            ));
            continue;
        };
        for entry in entries {
            let Some(enabled) = entry.get("enabled").and_then(toml::Value::as_bool) else {
                continue;
            };
            if let Some(path) = entry.get("path").and_then(toml::Value::as_str) {
                let path = if let Some(suffix) = path.strip_prefix("~/") {
                    home.join(suffix)
                } else {
                    PathBuf::from(path)
                };
                if path.is_absolute() {
                    path_state.insert(path.canonicalize().unwrap_or(path), enabled);
                }
            } else if let Some(name) = entry.get("name").and_then(toml::Value::as_str) {
                name_state.insert(name.to_string(), enabled);
            }
        }
    }
    (
        path_state
            .into_iter()
            .filter_map(|(path, enabled)| (!enabled).then_some(path))
            .collect(),
        name_state
            .into_iter()
            .filter_map(|(name, enabled)| (!enabled).then_some(name))
            .collect(),
        errors,
        format!("{:x}", digest.finalize()),
    )
}

fn runtime_variable(configuration: &RuntimeStartupConfiguration, name: &str) -> Option<OsString> {
    configuration
        .environment
        .iter()
        .find(|entry| {
            if cfg!(windows) {
                entry.name.eq_ignore_ascii_case(name)
            } else {
                entry.name == name
            }
        })
        .map(|entry| OsString::from(&entry.value))
        .or_else(|| std::env::var_os(name))
}

fn configured_root(
    name: &str,
    fallback: PathBuf,
    configuration: &RuntimeStartupConfiguration,
) -> PathBuf {
    runtime_variable(configuration, name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(fallback)
}

fn user_roots(
    adapter: AdapterKind,
    home: &Path,
    configuration: &RuntimeStartupConfiguration,
) -> Vec<(&'static str, PathBuf)> {
    let mut paths = Vec::<PathBuf>::new();
    let agents = home.join(".agents/skills");
    let claude = home.join(".claude/skills");
    match adapter {
        AdapterKind::CodexCli => {
            paths.push(agents);
            paths.push(
                configured_root("CODEX_HOME", home.join(".codex"), configuration).join("skills"),
            );
        }
        AdapterKind::ClaudeCodeCli => paths.push(
            configured_root("CLAUDE_CONFIG_DIR", home.join(".claude"), configuration)
                .join("skills"),
        ),
        AdapterKind::Pi => {
            paths.push(
                configured_root("PI_CODING_AGENT_DIR", home.join(".pi/agent"), configuration)
                    .join("skills"),
            );
            paths.push(agents);
        }
        AdapterKind::OpencodeCli => {
            let xdg = configured_root("XDG_CONFIG_HOME", home.join(".config"), configuration);
            paths.push(xdg.join("opencode/skills"));
            paths.push(agents);
            paths.push(claude);
        }
        AdapterKind::CopilotCli => {
            paths.push(home.join(".copilot/skills"));
            paths.push(agents);
            if let Some(extra) = runtime_variable(configuration, "COPILOT_SKILLS_DIRS") {
                paths.extend(
                    extra
                        .to_string_lossy()
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(PathBuf::from)
                        .filter(|path| path.is_absolute()),
                );
            }
        }
        AdapterKind::KiroCli => paths.push(home.join(".kiro/skills")),
        AdapterKind::QoderCli => paths.push(
            configured_root("QODER_CONFIG_DIR", home.join(".qoder"), configuration).join("skills"),
        ),
        AdapterKind::CodebuddyCli => paths.push(home.join(".codebuddy/skills")),
        AdapterKind::QwenCode => paths.push(
            configured_root("QWEN_CODE_HOME", home.join(".qwen"), configuration).join("skills"),
        ),
        AdapterKind::TraeCnCli => paths.extend(
            [
                ".traecli/skills",
                ".trae/skills",
                ".trae-cn/skills",
                ".coco/skills",
            ]
            .map(|part| home.join(part)),
        ),
        AdapterKind::CursorAgent => paths.extend(
            [
                ".cursor/skills",
                ".agents/skills",
                ".claude/skills",
                ".codex/skills",
                ".cursor/skills-cursor",
            ]
            .map(|part| home.join(part)),
        ),
        AdapterKind::KimiCodeCli => {
            paths.push(
                configured_root("KIMI_CODE_HOME", home.join(".kimi-code"), configuration)
                    .join("skills"),
            );
            paths.push(agents);
        }
        AdapterKind::GrokBuild => paths
            .push(configured_root("GROK_HOME", home.join(".grok"), configuration).join("skills")),
        AdapterKind::DeepseekHarness => {
            paths
                .push(configured_root("DSH_HOME", home.join(".dsh"), configuration).join("skills"));
            paths.push(
                configured_root("DSH_AGENTS_HOME", home.join(".agents"), configuration)
                    .join("skills"),
            );
        }
        AdapterKind::ZcodeApp => paths.push(home.join(".zcode/skills")),
        AdapterKind::AntigravityApp => paths.extend(
            [".gemini/config/skills", ".gemini/antigravity/skills"].map(|part| home.join(part)),
        ),
    }
    paths.into_iter().map(|path| ("user", path)).collect()
}

fn project_roots(adapter: AdapterKind, project: &Path) -> Vec<(&'static str, PathBuf)> {
    let ancestors = matches!(
        adapter,
        AdapterKind::CodexCli
            | AdapterKind::ClaudeCodeCli
            | AdapterKind::Pi
            | AdapterKind::OpencodeCli
    );
    let mut directories = vec![project.to_path_buf()];
    if ancestors {
        let mut current = project;
        while !current.join(".git").exists() {
            let Some(parent) = current.parent() else {
                break;
            };
            if parent == current {
                break;
            }
            directories.push(parent.to_path_buf());
            current = parent;
        }
    }
    let parts: &[&str] = match adapter {
        AdapterKind::CodexCli => &[".agents/skills", ".codex/skills"],
        AdapterKind::ClaudeCodeCli => &[".claude/skills"],
        AdapterKind::Pi => &[".pi/skills", ".agents/skills"],
        AdapterKind::OpencodeCli => &[".opencode/skills", ".agents/skills", ".claude/skills"],
        AdapterKind::CopilotCli => &[".github/skills", ".agents/skills", ".claude/skills"],
        AdapterKind::KiroCli => &[".kiro/skills"],
        AdapterKind::QoderCli => &[".qoder/skills", ".agents/skills"],
        AdapterKind::CodebuddyCli => &[".codebuddy/skills"],
        AdapterKind::QwenCode => &[".qwen/skills"],
        AdapterKind::TraeCnCli => &[".traecli/skills", ".trae/skills", ".agents/skills"],
        AdapterKind::CursorAgent => &[
            ".cursor/skills",
            ".agents/skills",
            ".claude/skills",
            ".codex/skills",
        ],
        AdapterKind::KimiCodeCli => &[".kimi-code/skills", ".agents/skills"],
        AdapterKind::GrokBuild => &[".grok/skills"],
        AdapterKind::DeepseekHarness => &[".dsh/skills", ".agents/skills"],
        AdapterKind::ZcodeApp => &[".zcode/skills"],
        AdapterKind::AntigravityApp => &[".agents/skills", ".agent/skills"],
    };
    directories
        .into_iter()
        .flat_map(|directory| {
            parts
                .iter()
                .map(move |part| ("project", directory.join(part)))
        })
        .collect()
}

fn scan_root(
    adapter: AdapterKind,
    scope: &str,
    root: &Path,
    seen: &mut HashSet<PathBuf>,
    scan: &mut NativeSkillScan,
) {
    let items = match fs::read_dir(root) {
        Ok(items) => items,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            scan.errors.push(format!("{}: {error}", root.display()));
            return;
        }
    };
    for (index, item) in items.enumerate() {
        if index >= MAX_SKILLS_PER_ROOT {
            scan.errors
                .push(format!("{}: scan limit reached", root.display()));
            break;
        }
        let item = match item {
            Ok(item) => item,
            Err(error) => {
                scan.errors.push(format!("{}: {error}", root.display()));
                continue;
            }
        };
        let entry = item.path();
        if item.file_name() == ".system"
            && root.file_name().is_none_or(|name| name != ".system")
            && item.file_type().is_ok_and(|kind| kind.is_dir())
        {
            scan_root(adapter, scope, &entry, seen, scan);
            continue;
        }
        let skill_file = if entry.is_dir() {
            entry.join("SKILL.md")
        } else {
            entry.clone()
        };
        if skill_file.file_name().is_none_or(|name| name != "SKILL.md") || !skill_file.is_file() {
            continue;
        }
        let canonical = match skill_file.canonicalize() {
            Ok(path) => path,
            Err(error) => {
                scan.errors
                    .push(format!("{}: {error}", skill_file.display()));
                continue;
            }
        };
        if !seen.insert(canonical.clone()) {
            continue;
        }
        match read_native_skill(&skill_file, &canonical, scope, adapter) {
            Ok(skill) => scan.skills.push(skill),
            Err(error) => scan
                .errors
                .push(format!("{}: {error:#}", skill_file.display())),
        }
    }
}

pub fn read_native_skill(
    entry: &Path,
    canonical: &Path,
    scope: &str,
    adapter: AdapterKind,
) -> Result<NativeSkill> {
    let content = fs::read_to_string(entry).with_context(|| "Skill entry is unreadable")?;
    let mut lines = content.split_inclusive('\n');
    ensure!(
        lines
            .next()
            .is_some_and(|line| line.trim_end_matches(['\r', '\n']) == "---"),
        "Skill frontmatter is missing"
    );
    let mut yaml = String::new();
    let mut terminated = false;
    for line in lines {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            terminated = true;
            break;
        }
        yaml.push_str(line);
    }
    ensure!(terminated, "Skill frontmatter is unterminated");
    #[derive(Deserialize)]
    struct Metadata {
        name: Option<String>,
        description: Option<String>,
    }
    let metadata: Metadata = serde_yaml::from_str(&yaml)?;
    let name = metadata.name.unwrap_or_else(|| {
        entry
            .parent()
            .and_then(Path::file_name)
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    ensure!(!name.trim().is_empty(), "Skill name is empty");
    let canonical_path = canonical.to_string_lossy().into_owned();
    let id = format!("native:{:x}", Sha256::digest(canonical_path.as_bytes()));
    Ok(NativeSkill {
        id,
        name,
        description: metadata.description.unwrap_or_default(),
        entry_path: entry.to_string_lossy().into_owned(),
        canonical_path,
        source_scope: scope.to_owned(),
        adapter_kind: adapter,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_startup::RuntimeEnvironmentVariable;

    #[cfg(feature = "extended-tests")]
    #[test]
    fn native_reference_batch_rolls_back_when_one_source_is_invalid() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-register-{}", Uuid::new_v4()));
        let mut database = Database::open(&fixture).unwrap();
        let valid = NativeSkill {
            id: "native:valid".to_string(),
            name: "valid".to_string(),
            description: "Valid".to_string(),
            entry_path: "/tmp/valid/SKILL.md".to_string(),
            canonical_path: "/tmp/valid/SKILL.md".to_string(),
            source_scope: "user".to_string(),
            adapter_kind: AdapterKind::CodexCli,
        };
        let mut invalid = valid.clone();
        invalid.id = "native:invalid".to_string();
        invalid.source_scope = "invalid".to_string();
        assert!(remember_native_skill_references(&mut database, &[valid, invalid]).is_err());
        let count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM native_skill_reference WHERE id LIKE 'native:%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn runtime_directory_overrides_change_native_candidates_without_explicit_refresh() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-roots-{}", uuid::Uuid::new_v4()));
        let home = fixture.join("home");
        let first = fixture.join("first");
        let second = fixture.join("second");
        for (root, name) in [(&first, "one"), (&second, "two")] {
            let directory = root.join("skills").join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: Native source\n---\n"),
            )
            .unwrap();
        }
        fs::create_dir_all(&home).unwrap();
        let configuration = |root: &Path| RuntimeStartupConfiguration {
            program_path: None,
            environment: vec![
                RuntimeEnvironmentVariable {
                    name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_owned(),
                    value: home.to_string_lossy().into_owned(),
                },
                RuntimeEnvironmentVariable {
                    name: "CODEX_HOME".to_owned(),
                    value: root.to_string_lossy().into_owned(),
                },
            ],
        };
        let discovery = NativeSkillDiscovery::default();
        let first_scan = discovery
            .discover(
                AdapterKind::CodexCli,
                None,
                true,
                false,
                &configuration(&first),
            )
            .unwrap();
        let second_scan = discovery
            .discover(
                AdapterKind::CodexCli,
                None,
                true,
                false,
                &configuration(&second),
            )
            .unwrap();
        assert_eq!(
            first_scan
                .skills
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            ["one"]
        );
        assert_eq!(
            second_scan
                .skills
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            ["two"]
        );
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn codex_explicit_disable_removes_candidate_and_config_change_invalidates_cache() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-disabled-{}", uuid::Uuid::new_v4()));
        let home = fixture.join("home");
        let codex_home = home.join(".codex");
        let skill_dir = codex_home.join("skills/review");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: review\ndescription: Review\n---\n",
        )
        .unwrap();
        let configuration = RuntimeStartupConfiguration {
            program_path: None,
            environment: vec![RuntimeEnvironmentVariable {
                name: if cfg!(windows) { "USERPROFILE" } else { "HOME" }.to_owned(),
                value: home.to_string_lossy().into_owned(),
            }],
        };
        let discovery = NativeSkillDiscovery::default();
        fs::write(
            codex_home.join("config.toml"),
            format!(
                "[[skills.config]]\npath = {:?}\nenabled = false\n",
                skill_dir.join("SKILL.md").to_string_lossy()
            ),
        )
        .unwrap();
        assert!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .is_empty()
        );
        fs::write(
            codex_home.join("config.toml"),
            "[[skills.config]]\nname = \"review\"\nenabled = false\n",
        )
        .unwrap();
        assert!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .is_empty()
        );
        fs::write(
            codex_home.join("config.toml"),
            format!(
                "[[skills.config]]\npath = {:?}\nenabled = false\n",
                skill_dir.to_string_lossy()
            ),
        )
        .unwrap();
        assert!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .is_empty()
        );
        fs::write(
            codex_home.join("config.toml"),
            "[[skills.config]]\nname = \"review\"\nenabled = true\n",
        )
        .unwrap();
        assert_eq!(
            discovery
                .discover(AdapterKind::CodexCli, None, true, false, &configuration)
                .unwrap()
                .skills
                .len(),
            1
        );
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn same_name_sources_keep_separate_identities_and_bad_entries_are_reported() {
        let fixture =
            std::env::temp_dir().join(format!("rovai-native-skills-{}", uuid::Uuid::new_v4()));
        let user_root = fixture.join("user");
        let project_root = fixture.join("project");
        for root in [&user_root, &project_root] {
            fs::create_dir_all(root.join("review")).unwrap();
            fs::write(
                root.join("review/SKILL.md"),
                "---\nname: review\ndescription: Review code\n---\n",
            )
            .unwrap();
        }
        fs::create_dir_all(project_root.join("broken")).unwrap();
        fs::write(
            project_root.join("broken/SKILL.md"),
            "---\nname: [invalid\n---\n",
        )
        .unwrap();

        let mut scan = NativeSkillScan {
            skills: Vec::new(),
            errors: Vec::new(),
        };
        let mut seen = HashSet::new();
        scan_root(
            AdapterKind::CodexCli,
            "user",
            &user_root,
            &mut seen,
            &mut scan,
        );
        scan_root(
            AdapterKind::CodexCli,
            "project",
            &project_root,
            &mut seen,
            &mut scan,
        );

        assert_eq!(scan.skills.len(), 2);
        assert_eq!(scan.skills[0].name, scan.skills[1].name);
        assert_ne!(scan.skills[0].id, scan.skills[1].id);
        assert_eq!(scan.errors.len(), 1);
        assert!(scan.errors[0].contains("broken"));
        fs::remove_dir_all(fixture).unwrap();
    }
}
