use rovai_core::application::{
    CoreService, HostControl, HostControlError, HostControlFuture, HostWebOperation,
};
use rovai_web::{WebConfig, WebServer, new_token};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct WebControl {
    core: CoreService,
    channels: Option<Arc<crate::desktop_channels::DesktopChannels>>,
    state: Mutex<WebControlState>,
}

impl WebControl {
    pub fn new(core: CoreService, desktop: bool) -> Arc<Self> {
        Arc::new(Self {
            channels: desktop
                .then(|| Arc::new(crate::desktop_channels::DesktopChannels::new(core.clone()))),
            core,
            state: Mutex::new(WebControlState {
                server: None,
                administrator: None,
            }),
        })
    }

    pub async fn start(&self, config: WebConfig, token: &str) -> anyhow::Result<Value> {
        self.state
            .lock()
            .await
            .start(
                self.core.clone(),
                config,
                token,
                self.channels
                    .clone()
                    .map(|channels| channels as Arc<dyn rovai_web::ChannelHost>),
            )
            .await
    }

    pub async fn stop(&self) {
        let mut state = self.state.lock().await;
        if let Some(server) = state.server.take() {
            server.stop().await;
        }
    }
}

impl HostControl for WebControl {
    fn web(&self, operation: HostWebOperation, params: Value) -> HostControlFuture<'_> {
        Box::pin(async move {
            let invalid = || HostControlError {
                code: "HOST_WEB_INVALID_CONFIG",
                message: "Web 配置无效，请检查监听地址、公开地址和 WebUI 目录。".into(),
            };
            match operation {
                HostWebOperation::ChannelDispatch | HostWebOperation::ChannelReply => {
                    let channels = self.channels.as_ref().ok_or(HostControlError {
                        code: "CHANNELS_UNSUPPORTED",
                        message: "Desktop channels are unavailable in this deployment".into(),
                    })?;
                    if matches!(operation, HostWebOperation::ChannelDispatch) {
                        channels.dispatch(params)
                    } else {
                        channels.reply(params)
                    }
                }
                HostWebOperation::Status => Ok(self
                    .state
                    .lock()
                    .await
                    .server
                    .as_ref()
                    .map(WebServer::status)
                    .unwrap_or_else(|| json!({"enabled":false,"sessions":0}))),
                HostWebOperation::Token => {
                    let token = self.state.lock().await.token()?;
                    Ok(json!({"administratorToken":token}))
                }
                HostWebOperation::LoginTicket => {
                    let state = self.state.lock().await;
                    let server = state.server.as_ref().ok_or(HostControlError {
                        code: "HOST_WEB_DISABLED",
                        message: "请先开启 Web 服务。".into(),
                    })?;
                    server.login_ticket().map_err(|_| HostControlError {
                        code: "HOST_WEB_TICKET_UNAVAILABLE",
                        message: "扫码登录暂不可用，请重新生成二维码。".into(),
                    })
                }
                HostWebOperation::Start => {
                    let config: WebConfig =
                        serde_json::from_value(params).map_err(|_| invalid())?;
                    let mut state = self.state.lock().await;
                    let token = state.token()?;
                    let mut status = state.start(self.core.clone(), config, &token, self.channels.clone().map(|channels| channels as Arc<dyn rovai_web::ChannelHost>)).await.map_err(|_| HostControlError { code: "HOST_WEB_START_FAILED", message: "Web 服务未开启。请检查端口是否被占用、WebUI 是否已构建，以及局域网访问是否已明确开启。".into() })?;
                    // The closed, parent-owned pipe returns this only to the
                    // local manager. It is absent from status and diagnostics.
                    status["administratorToken"] = json!(token);
                    Ok(status)
                }
                HostWebOperation::Stop => {
                    self.stop().await;
                    Ok(json!({"enabled":false,"sessions":0}))
                }
                HostWebOperation::Rotate => {
                    let mut state = self.state.lock().await;
                    let server = state.server.as_ref().ok_or(HostControlError {
                        code: "HOST_WEB_DISABLED",
                        message: "请先开启 Web 服务。".into(),
                    })?;
                    let token = server.rotate().map_err(|_| invalid())?;
                    let mut status = server.status();
                    state.administrator = Some(token.clone());
                    status["administratorToken"] = json!(token);
                    Ok(status)
                }
            }
        })
    }
}

// The local Host owns this credential across listener restarts. It is never
// part of status, diagnostics, or remote HTTP; no Debug/Serialize is derived.
struct WebControlState {
    server: Option<WebServer>,
    administrator: Option<String>,
}

impl WebControlState {
    fn token(&mut self) -> Result<String, HostControlError> {
        if self.administrator.is_none() {
            self.administrator = Some(new_token().map_err(|_| HostControlError {
                code: "HOST_RANDOM_UNAVAILABLE",
                message: "系统随机数暂不可用。".into(),
            })?);
        }
        Ok(self
            .administrator
            .as_ref()
            .expect("administrator initialized")
            .clone())
    }

    async fn start(
        &mut self,
        core: CoreService,
        config: WebConfig,
        token: &str,
        channels: Option<Arc<dyn rovai_web::ChannelHost>>,
    ) -> anyhow::Result<Value> {
        anyhow::ensure!(self.server.is_none(), "Web service is already running");
        let running = WebServer::start_with_channels(core, config, token, channels).await?;
        let status = running.status();
        self.administrator = Some(token.to_owned());
        self.server = Some(running);
        Ok(status)
    }
}
