use anyhow::{Context, Result, ensure};
use clap::{Parser, Subcommand};
use rovai_core::{application::CoreConfig, storage_layout::ServerPaths};
use std::{
    fs::File,
    io::{self, Seek, SeekFrom, Write},
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Parser)]
#[command(
    name = "rovai-server",
    version,
    about = "Run the shared Rovai Host with one standalone data root"
)]
struct Cli {
    /// All Rovai-owned Server data. Defaults to ~/.rovai-server, independently of cwd.
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,
    #[arg(long, default_value = "127.0.0.1:4317")]
    listen: SocketAddr,
    #[arg(long)]
    public_origin: Option<String>,
    /// Explicitly allow unencrypted LAN HTTP; use HTTPS/VPN on untrusted networks.
    #[arg(long)]
    allow_insecure_lan: bool,
    /// Developer-only override. Installed packages locate their matching WebUI automatically.
    #[arg(long, hide = true)]
    web_ui: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Print the stored management token. Treat stdout as a secret.
    Token,
    /// Show resolved data paths without starting Core or opening a database.
    Paths,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    let home = dirs::home_dir().context("Current account's Home is unavailable")?;
    let default_root = home.join(".rovai-server");
    let data_dir = cli.data_dir.unwrap_or_else(|| default_root.clone());
    if data_dir == default_root && !default_root.join("rovai.sqlite").try_exists()? {
        ensure!(
            !home.join(".rovai/server/rovai.sqlite").try_exists()?,
            "server_legacy_layout: previous preview data exists at ~/.rovai/server. No empty default instance was created. Keep its original Host invocation until the complete instance is migrated."
        );
    }
    if matches!(cli.command, Some(Command::Paths)) {
        println!(
            "{}",
            serde_json::to_string_pretty(&ServerPaths::from_data_dir(&data_dir)?)?
        );
        return Ok(());
    }
    // Resolve packaged resources before creating data. A missing WebUI should
    // report a broken installation, not leave a new empty business instance.
    let web_ui = if matches!(cli.command, Some(Command::Token)) {
        None
    } else {
        let directory = cli.web_ui.unwrap_or(
            std::env::current_exe()?
                .parent()
                .context("Server executable has no directory")?
                .join("web-ui"),
        );
        let directory = std::fs::canonicalize(directory)
            .context("Matching WebUI is missing; reinstall the complete Server package")?;
        ensure!(
            directory.join("index.html").is_file(),
            "Matching WebUI is missing index.html; reinstall the complete Server package"
        );
        Some(directory)
    };
    let paths = ServerPaths::prepare(&data_dir)?;
    let token = paths.management_token(rovai_web::new_token)?;
    if matches!(cli.command, Some(Command::Token)) {
        println!("{token}");
        return Ok(());
    }
    let log = paths.open_log()?;
    let require_existing_authority = paths.database.try_exists()?
        || paths
            .runtime_camp_files_root
            .join(".runtime-camp-files-root.json")
            .try_exists()?;
    eprintln!("Rovai Server data: {}", paths.data_dir.display());
    eprintln!(
        "Management token: run rovai-server --data-dir <same-directory> token. The token is never printed in startup logs."
    );
    let config = CoreConfig {
        data_dir: paths.data_dir,
        skill_library_root: paths.skill_library_root,
        runtime_camp_files_root: paths.runtime_camp_files_root,
        mcp_config_path: Some(paths.mcp_config_path),
        require_existing_authority,
        automation_scheduler_control: None,
        removed_skill_project_roots: Default::default(),
    };
    super::run(
        config,
        Some((
            rovai_web::WebConfig {
                listen: cli.listen,
                public_origin: cli.public_origin,
                allow_insecure_lan: cli.allow_insecure_lan,
                ui_directory: web_ui.context("WebUI was not resolved")?,
            },
            token,
        )),
        false,
        Some(log),
    )
}

/// Both entrypoints retain stderr logging; only standalone Server additionally
/// persists it under its selected data root. Tokens never enter this writer.
#[derive(Clone)]
pub(crate) struct LogWriter(Option<Arc<Mutex<File>>>);

impl LogWriter {
    pub(crate) fn new(file: Option<File>) -> Self {
        Self(file.map(|file| Arc::new(Mutex::new(file))))
    }
}

impl Write for LogWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        io::stderr().write_all(bytes)?;
        if let Some(file) = &self.0 {
            let mut file = file
                .lock()
                .map_err(|_| io::Error::other("Server log lock is unavailable"))?;
            file.seek(SeekFrom::End(0))?;
            file.write_all(bytes)?;
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        io::stderr().flush()
    }
}
