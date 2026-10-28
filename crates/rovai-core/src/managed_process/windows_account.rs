//! Explicit account launch: trusted bootstrap waits for an in-memory request.
//! Parent assigns its kill-on-close Job BEFORE sending it; bootstrap then uses
//! the unchanged atomic native spawn. No runtime executes in the attach gap.
use super::*;
use crate::managed_process::WindowsAccountLaunch;
use anyhow::Context;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{BufRead, Read, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree},
    Security::{
        CreateWellKnownSid,
        Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData},
        EqualSid, GetTokenInformation, TOKEN_ELEVATION, TOKEN_GROUPS, TOKEN_QUERY, TokenElevation,
        TokenGroups, WinBuiltinAdministratorsSid,
    },
    System::{
        JobObjects::AssignProcessToJobObject,
        Pipes::PeekNamedPipe,
        Threading::{
            CREATE_NO_WINDOW, CreateProcessWithLogonW, OpenProcessToken, STARTUPINFOW,
            TerminateProcess,
        },
    },
};

const HELPER_FLAG: &str = "--rovai-account-helper";
const MAX_FRAME: usize = 16 * 1024 * 1024;
const START_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Deserialize)]
struct AccountRequest {
    application: PathBuf,
    identity: WindowsApplicationIdentity,
    arguments: Vec<OsString>,
    cwd: PathBuf,
    #[serde(
        serialize_with = "serialize_environment_pairs",
        deserialize_with = "deserialize_environment_pairs"
    )]
    environment: BTreeMap<OsString, OsString>,
    piped_stdin: bool,
    ownership: String,
    launch_files: Vec<(PathBuf, String)>,
}

// OsString preserves Windows UTF-16 via a tagged serde representation, which
// is valid as a sequence element but not a JSON object key.
fn serialize_environment_pairs<S: serde::Serializer>(
    environment: &BTreeMap<OsString, OsString>,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    serializer.collect_seq(environment.iter())
}
fn deserialize_environment_pairs<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<OsString, OsString>, D::Error> {
    Ok(Vec::<(OsString, OsString)>::deserialize(deserializer)?
        .into_iter()
        .collect())
}

struct Secret(Vec<u16>);
impl Drop for Secret {
    fn drop(&mut self) {
        for unit in &mut self.0 {
            unsafe { std::ptr::write_volatile(unit, 0) };
        }
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    }
}
struct Decrypted(CRYPT_INTEGER_BLOB);
impl Drop for Decrypted {
    fn drop(&mut self) {
        if !self.0.pbData.is_null() {
            for i in 0..self.0.cbData as usize {
                unsafe { std::ptr::write_volatile(self.0.pbData.add(i), 0) };
            }
            unsafe { LocalFree(self.0.pbData.cast()) };
        }
    }
}
fn password(path: &Path) -> Result<Secret> {
    let encoded =
        std::fs::read_to_string(path).context("managed_process.account_credential_unavailable")?;
    let encoded = encoded.trim().trim_start_matches('\u{feff}');
    anyhow::ensure!(
        !encoded.is_empty()
            && encoded.len() <= 128 * 1024
            && encoded.len() % 2 == 0
            && encoded.is_ascii(),
        "managed_process.account_credential_invalid"
    );
    let mut encrypted = (0..encoded.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&encoded[i..i + 2], 16))
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("managed_process.account_credential_invalid")?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_mut_ptr(),
    };
    let mut output = Decrypted(CRYPT_INTEGER_BLOB::default());
    if unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output.0,
        )
    } == 0
    {
        return Err(last_os_error("managed_process.account_credential_failed"));
    }
    anyhow::ensure!(
        output.0.cbData > 0 && output.0.cbData % 2 == 0,
        "managed_process.account_credential_invalid"
    );
    let bytes = unsafe { std::slice::from_raw_parts(output.0.pbData, output.0.cbData as usize) };
    let mut secret = Secret(
        bytes
            .chunks_exact(2)
            .map(|p| u16::from_le_bytes([p[0], p[1]]))
            .collect(),
    );
    anyhow::ensure!(
        !secret.0.contains(&0),
        "managed_process.account_credential_invalid"
    );
    secret.0.push(0);
    Ok(secret)
}

// Failure guard is armed from successful process creation through READY. This
// also reaps the bootstrap if assignment, write, EOF, or READY validation fails.
struct PendingAccount(Option<OwnedHandle>);
impl Drop for PendingAccount {
    fn drop(&mut self) {
        if let Some(process) = &self.0 {
            unsafe {
                TerminateProcess(raw_handle(process), 1);
                WaitForSingleObject(raw_handle(process), 5_000);
            }
        }
    }
}

fn helper_arguments() -> Vec<OsString> {
    #[cfg(test)]
    return [
        "--exact",
        "managed_process::windows::account::tests::account_helper_entry",
        "--ignored",
        "--nocapture",
        "--test-threads=1",
    ]
    .map(OsString::from)
    .to_vec();
    #[cfg(not(test))]
    vec![HELPER_FLAG.into()]
}

pub(super) fn spawn(spec: &ManagedProcessLaunchSpec) -> Result<WindowsManagedProcess> {
    let account = spec
        .windows_account
        .as_ref()
        .context("managed_process.account_config_required")?;
    anyhow::ensure!(
        matches!(
            spec.windows_entrypoint(),
            WindowsRuntimeEntrypoint::NativeExecutable { .. }
        ),
        "managed_process.account_native_executable_required"
    );
    prepare_workspace_access(spec.working_directory(), Some(account))?;
    let target_path = wide_nul(spec.application().as_os_str(), "application")?;
    let _target_lock = open_application_for_launch(&target_path)?;
    anyhow::ensure!(
        &application_identity_from_handle(raw_handle(&_target_lock))?
            == spec.application_identity(),
        "managed_process.invalid_application: application identity changed before launch"
    );
    let helper = std::env::current_exe().context("managed_process.account_helper_unavailable")?;
    let application = wide_nul(dunce::simplified(&helper).as_os_str(), "account helper")?;
    let _helper_lock = open_application_for_launch(&application)?;
    let mut argv = serialize_command_line(
        spec.windows_argv_dialect(),
        dunce::simplified(&helper).as_os_str(),
        &helper_arguments(),
    )?;
    anyhow::ensure!(
        argv.len() <= 1024,
        "managed_process.account_helper_command_too_long"
    );
    let username = wide_nul(account.username.as_ref(), "account username")?;
    let domain = wide_nul(account.domain.as_ref(), "account domain")?;
    let secret = password(&account.dpapi_path)?;
    let cwd = wide_nul(account.profile_root.as_os_str(), "account profile")?;
    // Bootstrap only receives system lookup/home values. Runtime credentials
    // and full arguments cross the private stdin pipe after Job assignment.
    let bootstrap_env = spec
        .environment()
        .iter()
        .filter(|(key, _)| {
            ["SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TEMP", "TMP"]
                .iter()
                .any(|allowed| environment_keys_equal(key, OsStr::new(allowed)))
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let environment = serialize_environment(&bootstrap_env)?;
    let job_name = format!("{RUNTIME_JOB_NAME_PREFIX}{}", uuid::Uuid::new_v4());
    let job = create_kill_on_close_job(&job_name)?;
    let (child_in, parent_in) = child_read_pipe()?;
    let (child_out, parent_out) = child_write_pipe()?;
    let (child_err, parent_err) = child_write_pipe()?;
    let mut startup = STARTUPINFOW::default();
    startup.cb = size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = raw_handle(&child_in);
    startup.hStdOutput = raw_handle(&child_out);
    startup.hStdError = raw_handle(&child_err);
    let mut pi = PROCESS_INFORMATION::default();
    if unsafe {
        CreateProcessWithLogonW(
            username.as_ptr(),
            domain.as_ptr(),
            secret.0.as_ptr(),
            0,
            application.as_ptr(),
            argv.as_mut_ptr(),
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup,
            &mut pi,
        )
    } == 0
    {
        return Err(last_os_error("managed_process.account_logon_failed"));
    }
    let mut pending = PendingAccount(Some(owned_handle(
        pi.hProcess,
        "managed_process.account_spawn_failed",
    )?));
    unsafe { CloseHandle(pi.hThread) };
    drop(child_in);
    drop(child_out);
    drop(child_err);
    drop(secret);
    let process = pending.0.as_ref().unwrap();
    reject_elevated_account(raw_handle(process))?;
    if unsafe { AssignProcessToJobObject(raw_handle(&job), raw_handle(process)) } == 0 {
        return Err(last_os_error("managed_process.account_assignment_failed"));
    }
    let request = AccountRequest {
        application: spec.application().to_owned(),
        identity: spec.application_identity().clone(),
        arguments: spec.arguments().to_vec(),
        cwd: spec.working_directory().to_owned(),
        environment: spec.environment().clone(),
        piped_stdin: spec.stdin_policy() == ManagedStdinPolicy::Piped,
        ownership: spec.ownership().to_owned(),
        launch_files: spec
            .account_launch_files
            .iter()
            .map(|(path, bytes)| (path.clone(), BASE64.encode(bytes)))
            .collect(),
    };
    let mut frame = serde_json::to_vec(&request)?;
    anyhow::ensure!(
        frame.len() < MAX_FRAME,
        "managed_process.account_request_too_large"
    );
    frame.push(b'\n');
    let (sent, receive) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = File::from(parent_in);
        let result = input.write_all(&frame).map(|()| input);
        let _ = sent.send(result);
    });
    let input = receive
        .recv_timeout(START_TIMEOUT)
        .context("managed_process.account_handshake_timeout")??;
    let pid = read_ready(&parent_out, process)?;
    Ok(WindowsManagedProcess {
        process: pending.0.take().unwrap(),
        job,
        job_name,
        pid,
        stdin: if request.piped_stdin {
            Some(tokio::fs::File::from_std(input))
        } else {
            None
        },
        stdout: Some(tokio_file(parent_out)),
        stderr: Some(tokio_file(parent_err)),
        exit_code: None,
    })
}

fn prepare_workspace_access(cwd: &Path, account: Option<&WindowsAccountLaunch>) -> Result<()> {
    let Some(account) = account else {
        return Ok(());
    };
    anyhow::ensure!(
        cwd.is_dir(),
        "managed_process.account_workspace_missing: {}",
        cwd.display()
    );
    let system_root =
        std::env::var_os("SystemRoot").context("managed_process.account_acl_tool_unavailable")?;
    let icacls = PathBuf::from(system_root)
        .join("System32")
        .join("icacls.exe");
    let cwd = dunce::simplified(cwd);
    let domain = if account.domain == "." {
        std::env::var("COMPUTERNAME")
            .context("managed_process.account_computer_name_unavailable")?
    } else {
        account.domain.clone()
    };
    let principal = format!("{}\\{}:(GR,GW)", domain, account.username);
    let output = Command::new(icacls)
        .arg(cwd.as_os_str())
        .arg("/grant:r")
        .arg(principal)
        .arg("/Q")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("managed_process.account_workspace_acl_failed")?;
    anyhow::ensure!(
        output.status.success(),
        "managed_process.account_workspace_acl_failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(())
}

fn reject_elevated_account(process: HANDLE) -> Result<()> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) } == 0 {
        return Err(last_os_error("managed_process.account_token_failed"));
    }
    let token = owned_handle(token, "managed_process.account_token_failed")?;
    let mut elevation = TOKEN_ELEVATION::default();
    let mut size = 0;
    if unsafe {
        GetTokenInformation(
            raw_handle(&token),
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
    } == 0
    {
        return Err(last_os_error("managed_process.account_token_failed"));
    }
    anyhow::ensure!(
        elevation.TokenIsElevated == 0,
        "managed_process.account_must_be_non_elevated"
    );
    // A filtered administrator token is non-elevated too. Reject membership,
    // including deny-only membership, rather than treating UAC as isolation.
    let mut administrators = [0u8; 68];
    let mut sid_size = administrators.len() as u32;
    if unsafe {
        CreateWellKnownSid(
            WinBuiltinAdministratorsSid,
            null_mut(),
            administrators.as_mut_ptr().cast(),
            &mut sid_size,
        )
    } == 0
    {
        return Err(last_os_error("managed_process.account_token_failed"));
    }
    let mut length = 0;
    unsafe { GetTokenInformation(raw_handle(&token), TokenGroups, null_mut(), 0, &mut length) };
    anyhow::ensure!(length > 0, "managed_process.account_token_failed");
    let mut buffer = vec![0usize; (length as usize).div_ceil(size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            raw_handle(&token),
            TokenGroups,
            buffer.as_mut_ptr().cast(),
            length,
            &mut length,
        )
    } == 0
    {
        return Err(last_os_error("managed_process.account_token_failed"));
    }
    let groups = unsafe { &*buffer.as_ptr().cast::<TOKEN_GROUPS>() };
    for group in
        unsafe { std::slice::from_raw_parts(groups.Groups.as_ptr(), groups.GroupCount as usize) }
    {
        anyhow::ensure!(
            unsafe { EqualSid(group.Sid, administrators.as_mut_ptr().cast()) } == 0,
            "managed_process.account_must_be_non_administrator"
        );
    }
    Ok(())
}

fn read_ready(pipe: &OwnedHandle, process: &OwnedHandle) -> Result<u32> {
    let until = Instant::now() + START_TIMEOUT;
    let mut bytes = Vec::new();
    let mut file = File::from(pipe.try_clone()?);
    loop {
        anyhow::ensure!(
            Instant::now() < until,
            "managed_process.account_handshake_timeout"
        );
        let mut available = 0;
        if unsafe {
            PeekNamedPipe(
                raw_handle(pipe),
                null_mut(),
                0,
                null_mut(),
                &mut available,
                null_mut(),
            )
        } == 0
        {
            bail!("managed_process.account_helper_failed");
        }
        if available > 0 {
            let mut byte = [0];
            file.read_exact(&mut byte)?;
            bytes.push(byte[0]);
            anyhow::ensure!(
                bytes.len() < 1024,
                "managed_process.account_helper_invalid_ready"
            );
            if byte[0] == b'\n' {
                let text = std::str::from_utf8(&bytes)
                    .context("managed_process.account_helper_invalid_ready")?;
                // Test harness banners precede the dedicated READY line.
                if let Some(pid) = text
                    .trim()
                    .rsplit_once("ROVAI_ACCOUNT_READY ")
                    .map(|(_, pid)| pid)
                {
                    return pid
                        .parse()
                        .context("managed_process.account_helper_invalid_ready");
                }
                bytes.clear();
            }
        } else {
            anyhow::ensure!(
                !process_has_exited(process)?,
                "managed_process.account_helper_failed"
            );
            anyhow::ensure!(
                Instant::now() < until,
                "managed_process.account_handshake_timeout"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

pub(crate) fn run_if_requested() -> Result<bool> {
    if std::env::args_os().nth(1).as_deref() != Some(OsStr::new(HELPER_FLAG)) {
        return Ok(false);
    }
    std::process::exit(run_helper()? as i32);
}

struct AccountInputs(Option<PathBuf>, bool);
impl Drop for AccountInputs {
    fn drop(&mut self) {
        if self.1
            && let Some(root) = &self.0
        {
            let _ = std::fs::remove_dir_all(root);
        }
    }
}
fn materialize_inputs(request: &mut AccountRequest) -> Result<AccountInputs> {
    if request.launch_files.is_empty() {
        return Ok(AccountInputs(None, true));
    }
    let temp = super::super::environment_value(&request.environment, "TEMP".as_ref())
        .context("account helper TEMP required")?;
    let root = PathBuf::from(temp).join(format!("rovai-inputs-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root)?;
    let inputs = AccountInputs(Some(root.clone()), true);
    for (index, (source, bytes)) in request.launch_files.iter().enumerate() {
        let target = root.join(format!(
            "input-{index}.{}",
            source
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("json")
        ));
        let mut matched = false;
        for argument in &mut request.arguments {
            if argument == source.as_os_str() {
                *argument = target.as_os_str().to_owned();
                matched = true;
            }
        }
        anyhow::ensure!(matched, "account helper input has no argv reference");
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?
            .write_all(
                &BASE64
                    .decode(bytes)
                    .context("account helper invalid input encoding")?,
            )?;
    }
    Ok(inputs)
}

fn run_helper() -> Result<u32> {
    let mut frame = Vec::new();
    // No file, Runtime, or Tokio startup happens before the private GO frame.
    std::io::stdin()
        .lock()
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut frame)?;
    anyhow::ensure!(
        frame.last() == Some(&b'\n') && frame.len() <= MAX_FRAME,
        "account helper missing request"
    );
    let mut request: AccountRequest = serde_json::from_slice(&frame)
        .map_err(|_| anyhow::anyhow!("account helper invalid request"))?;
    for key in [
        "TEMP",
        "APPDATA",
        "LOCALAPPDATA",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_DATA_HOME",
    ] {
        if let Some(path) = super::super::environment_value(&request.environment, key.as_ref()) {
            std::fs::create_dir_all(path)?;
        }
    }
    let mut inputs = materialize_inputs(&mut request)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let mut command = tokio::process::Command::new(&request.application);
        command
            .args(&request.arguments)
            .current_dir(&request.cwd)
            .env_clear()
            .envs(&request.environment);
        let mut spec = ManagedProcessLaunchSpec::capture(
            &command,
            super::super::ManagedProcessPurpose::RuntimeHost,
            if request.piped_stdin {
                ManagedStdinPolicy::Piped
            } else {
                ManagedStdinPolicy::Null
            },
            ManagedWindowsArgvDialect::MicrosoftCrt,
            request.ownership,
        )?;
        anyhow::ensure!(
            spec.application_identity() == &request.identity,
            "account helper target identity changed"
        );
        spec.environment = request.environment;
        let mut child = WindowsManagedProcess::spawn(&spec)?;
        // After spawn, preserve inputs on unknown/failed cleanup. A later
        // process exit is not retroactive proof that deletion was safe.
        inputs.1 = false;
        println!("ROVAI_ACCOUNT_READY {}", child.id());
        std::io::stdout().flush()?;
        let (relay_errors, mut relay_error) = tokio::sync::mpsc::unbounded_channel();
        if let Some(input) = child.take_stdin() {
            let mut input = input.into_std().await;
            let errors = relay_errors.clone();
            std::thread::spawn(move || {
                if std::io::copy(&mut std::io::stdin().lock(), &mut input).is_err() {
                    let _ = errors.send(());
                }
            });
        }
        let mut output = child.take_stdout().unwrap().into_std().await;
        let mut error = child.take_stderr().unwrap().into_std().await;
        let errors = relay_errors.clone();
        let output = std::thread::spawn(move || {
            let result = std::io::copy(&mut output, &mut std::io::stdout().lock());
            if result.is_err() {
                let _ = errors.send(());
            }
            result
        });
        let errors = relay_errors.clone();
        let error = std::thread::spawn(move || {
            let result = std::io::copy(&mut error, &mut std::io::stderr().lock());
            if result.is_err() {
                let _ = errors.send(());
            }
            result
        });
        let status = tokio::select! {
            status = child.wait() => Some(status?),
            _ = relay_error.recv() => None,
        };
        let relay_failed = status.is_none();
        let status = match status {
            Some(status) => status,
            None => {
                child.terminate_job()?;
                tokio::time::timeout(Duration::from_secs(5), child.wait())
                    .await
                    .context("account helper relay cleanup timed out")??
            }
        };
        child.terminate_job()?;
        let cleanup_deadline = Instant::now() + Duration::from_secs(5);
        while !child.tree_is_empty()? {
            anyhow::ensure!(
                Instant::now() < cleanup_deadline,
                "account helper cleanup timed out"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        inputs.1 = true;
        output
            .join()
            .map_err(|_| anyhow::anyhow!("account helper stdout failed"))??;
        error
            .join()
            .map_err(|_| anyhow::anyhow!("account helper stderr failed"))??;
        Ok(if relay_failed {
            1
        } else {
            status.code().unwrap_or(1) as u32
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managed_process::WindowsAccountLaunch;
    use std::{
        os::windows::process::CommandExt,
        path::{Path, PathBuf},
        process::Command,
    };
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    // These tests use a temporary ACL fixture only: no password, provider,
    // Core DB, user-data root or real Runtime is involved.
    #[test]
    fn account_workspace_acl_is_exact_idempotent_and_shared_is_unchanged() {
        let root = std::env::temp_dir().join(format!(
            "rovai-account-workspace-acl-{}",
            uuid::Uuid::new_v4()
        ));
        let cwd = root.join("run-cwd");
        let sibling = root.join("other");
        let child = cwd.join("existing-child.txt");
        std::fs::create_dir_all(&cwd).unwrap();
        std::fs::create_dir(&sibling).unwrap();
        std::fs::write(&child, "leave this ACL unchanged").unwrap();

        let account = if std::env::var_os("ROVAI_WINDOWS_ACCOUNT_CONFIG").is_some() {
            WindowsAccountLaunch::for_isolation("windows_account")
                .unwrap()
                .unwrap()
        } else {
            WindowsAccountLaunch {
                username: std::env::var("USERNAME").expect("Windows test user name"),
                domain: std::env::var("USERDOMAIN")
                    .or_else(|_| std::env::var("COMPUTERNAME"))
                    .unwrap_or_else(|_| ".".to_string()),
                dpapi_path: root.join("unused-dpapi.bin"),
                profile_root: root.clone(),
            }
        };
        let root_before = icacls_text(&root);
        let cwd_before = icacls_text(&cwd);
        let sibling_before = icacls_text(&sibling);
        let child_before = icacls_text(&child);

        prepare_workspace_access(&cwd, None).unwrap();
        assert_eq!(
            icacls_text(&cwd),
            cwd_before,
            "shared mode must not add an ACE"
        );
        assert_eq!(icacls_text(&root), root_before);
        assert_eq!(icacls_text(&sibling), sibling_before);
        assert_eq!(icacls_text(&child), child_before);

        prepare_workspace_access(&cwd, Some(&account)).unwrap();
        let granted = icacls_text(&cwd);
        let principal_ace = format!(
            "{}\\{}:(r,w)",
            account.domain.to_lowercase(),
            account.username.to_lowercase()
        );
        let account_line = granted
            .lines()
            .find(|line| line.to_lowercase().contains(&principal_ace))
            .expect("explicit read/write ACE for the sandbox account");
        let account_line = account_line.to_lowercase();
        assert!(
            !account_line.contains("(oi)"),
            "ACE must not inherit to files"
        );
        assert!(
            !account_line.contains("(ci)"),
            "ACE must not inherit to directories"
        );
        assert_eq!(
            icacls_text(&root),
            root_before,
            "data-root ACL must stay unchanged"
        );
        assert_eq!(icacls_text(&sibling), sibling_before);
        assert_eq!(
            icacls_text(&child),
            child_before,
            "existing descendants must stay unchanged"
        );

        prepare_workspace_access(&cwd, Some(&account)).unwrap();
        assert_eq!(
            icacls_text(&cwd),
            granted,
            "repeated turns must keep one stable ACE"
        );
        assert_eq!(icacls_text(&root), root_before);
        assert_eq!(icacls_text(&sibling), sibling_before);
        assert_eq!(icacls_text(&child), child_before);
        std::fs::remove_dir_all(root).unwrap();
    }

    fn icacls_text(path: &Path) -> String {
        let system_root = std::env::var_os("SystemRoot").unwrap();
        let icacls = PathBuf::from(system_root)
            .join("System32")
            .join("icacls.exe");
        let output = Command::new(icacls)
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(output.status.success(), "icacls read failed: {output:?}");
        String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n")
    }

    #[tokio::test]
    async fn account_bootstrap_requires_request_and_relays_native_exit() {
        use super::*;
        let root =
            std::env::temp_dir().join(format!("rovai-account-bootstrap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command.args(helper_arguments()).current_dir(&root);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            super::super::super::ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "account-bootstrap-test",
        )
        .unwrap();
        let mut no_request = WindowsManagedProcess::spawn(&spec).unwrap();
        drop(no_request.take_stdin());
        let status = tokio::time::timeout(Duration::from_secs(10), no_request.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(!status.success());
        wait_for_empty(&no_request).await;
        let executable =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/whoami.exe");
        let mut target = tokio::process::Command::new(&executable);
        target.current_dir(&root);
        let target = ManagedProcessLaunchSpec::capture(
            &target,
            super::super::super::ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "account-native-test",
        )
        .unwrap();
        let mut request = AccountRequest {
            application: target.application().to_owned(),
            identity: target.application_identity().clone(),
            arguments: vec![],
            cwd: root.clone(),
            environment: [
                (
                    OsString::from("SystemRoot"),
                    std::env::var_os("SystemRoot").unwrap(),
                ),
                (OsString::from("TEMP"), root.clone().into_os_string()),
            ]
            .into(),
            piped_stdin: false,
            ownership: "account-native-test".into(),
            launch_files: Vec::new(),
        };
        let source = root.join("host-private-input.json");
        request.arguments = vec![source.as_os_str().to_owned()];
        let input_bytes = vec![b'x'; 64 * 1024];
        request.launch_files = vec![(source, BASE64.encode(&input_bytes))];
        assert!(serde_json::to_vec(&request).unwrap().len() < MAX_FRAME);
        let inputs = materialize_inputs(&mut request).unwrap();
        let materialized = PathBuf::from(&request.arguments[0]);
        assert_eq!(std::fs::read(&materialized).unwrap(), input_bytes);
        drop(inputs);
        assert!(!materialized.exists());
        request.arguments.clear();
        request.launch_files.clear();
        let mut process = WindowsManagedProcess::spawn(&spec).unwrap();
        let mut input = process.take_stdin().unwrap().into_std().await;
        let mut frame = serde_json::to_vec(&request).unwrap();
        frame.push(b'\n');
        input.write_all(&frame).unwrap();
        drop(input);
        let mut output = process.take_stdout().unwrap();
        let mut bytes = Vec::new();
        tokio::time::timeout(
            Duration::from_secs(10),
            tokio::io::AsyncReadExt::read_to_end(&mut output, &mut bytes),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(process.wait().await.unwrap().success());
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("ROVAI_ACCOUNT_READY "), "{text}");
        assert!(text.contains('\\'), "{text}");
        wait_for_empty(&process).await;
        // A target that closes stdin must turn a large upstream write into a
        // bounded error, not strand it behind an idle bootstrap read handle.
        request.application = std::env::current_exe().unwrap();
        request.identity = spec.application_identity().clone();
        request.arguments = helper_arguments();
        request.piped_stdin = true;
        request
            .environment
            .insert("ROVAI_ACCOUNT_TEST_CLOSE_STDIN".into(), "1".into());
        let mut process = WindowsManagedProcess::spawn(&spec).unwrap();
        let mut input = process.take_stdin().unwrap();
        let mut frame = serde_json::to_vec(&request).unwrap();
        frame.push(b'\n');
        tokio::io::AsyncWriteExt::write_all(&mut input, &frame)
            .await
            .unwrap();
        let write = tokio::time::timeout(
            Duration::from_secs(10),
            tokio::io::AsyncWriteExt::write_all(&mut input, &vec![b'x'; 1024 * 1024]),
        )
        .await;
        assert!(write.is_ok(), "relay left the writer blocked");
        // Tokio File can buffer the final chunk; flush observes the native error.
        let flush = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::io::AsyncWriteExt::flush(&mut input),
        )
        .await
        .unwrap();
        assert!(write.unwrap().is_err() || flush.is_err());
        assert!(
            !tokio::time::timeout(Duration::from_secs(5), process.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
        wait_for_empty(&process).await;
        std::fs::remove_dir_all(root).unwrap();
    }

    async fn wait_for_empty(process: &super::WindowsManagedProcess) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !process.tree_is_empty().unwrap() {
            assert!(
                std::time::Instant::now() < deadline,
                "bootstrap Job did not empty"
            );
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    #[ignore = "manual existing non-admin account + owner-bound DPAPI; runs only Windows whoami, never an AI provider"]
    async fn existing_account_launch_starts_repeated_workspace_turns() {
        use super::*;
        let account = super::super::super::WindowsAccountLaunch::for_isolation("windows_account")
            .unwrap()
            .unwrap();
        let root = std::env::temp_dir().join(format!(
            "rovai-account-repeated-turns-{}",
            uuid::Uuid::new_v4()
        ));
        let cwd = root.join("run-cwd");
        std::fs::create_dir_all(&cwd).unwrap();
        let executable =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/whoami.exe");
        let mut command = tokio::process::Command::new(executable);
        command.current_dir(&cwd);
        let mut spec = ManagedProcessLaunchSpec::capture(
            &command,
            super::super::super::ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "account-product-whoami",
        )
        .unwrap();
        // Manual smoke must not transmit any provider environment, even when
        // the developer's shell contains one. This is test-only isolation.
        spec.environment.retain(|key, _| {
            ["SystemRoot", "WINDIR", "PATH", "ComSpec", "PATHEXT"]
                .iter()
                .any(|allowed| environment_keys_equal(key, OsStr::new(allowed)))
        });
        let spec = spec.with_windows_account(Some(account.clone())).unwrap();

        for round in 1..=3 {
            let mut process = WindowsManagedProcess::spawn(&spec).unwrap();
            let mut output = process.take_stdout().unwrap();
            let mut bytes = Vec::new();
            tokio::time::timeout(
                Duration::from_secs(15),
                tokio::io::AsyncReadExt::read_to_end(&mut output, &mut bytes),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(
                process.wait().await.unwrap().success(),
                "round {round} failed"
            );
            let identity = String::from_utf8(bytes).unwrap();
            assert!(
                identity
                    .trim()
                    .to_lowercase()
                    .ends_with(&format!("\\{}", account.username.to_lowercase()))
            );
            wait_for_empty(&process).await;
            let (total, active) = process.job_process_counts_for_test().unwrap();
            assert_eq!(active, 0, "round {round} left processes in its Job");
            println!(
                "product_account_spawn round={} identity={} job_total={} job_active={}",
                round,
                identity.trim(),
                total,
                active
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "subprocess-only trusted account bootstrap entry"]
    fn account_helper_entry() {
        if std::env::var_os("ROVAI_ACCOUNT_TEST_CLOSE_STDIN").is_some() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(
                    windows_sys::Win32::System::Console::GetStdHandle(
                        windows_sys::Win32::System::Console::STD_INPUT_HANDLE,
                    ),
                )
            };
            std::thread::sleep(std::time::Duration::from_secs(60));
            std::process::exit(0);
        }
        std::process::exit(super::run_helper().unwrap_or(1) as i32);
    }
}
