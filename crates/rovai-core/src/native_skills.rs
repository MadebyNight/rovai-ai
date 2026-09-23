//! Read-only discovery of Skills in the executing Host's native Harness paths.
//! Discovery neither projects Rovai content into a project nor mutates a
//! Harness configuration. A cache entry is only a candidate view, never an
//! authority for a frozen message or a Runtime's actual loaded state.

use std::{
    collections::{HashSet, VecDeque},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::agent_profile::AdapterKind;
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct CacheKey {
    adapter: AdapterKind,
    home: PathBuf,
    project: Option<PathBuf>,
    user_only: bool,
    roots: Vec<(&'static str, PathBuf)>,
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
        let key = CacheKey {
            adapter,
            home: home.clone(),
            project: project.clone(),
            user_only,
            roots: roots.clone(),
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
            errors: Vec::new(),
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
