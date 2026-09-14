//! A closed Desktop capability, never a generic Core or Electron RPC proxy.
use crate::{WebState, error};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{future::Future, pin::Pin};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelKind {
    Feishu,
    Dingtalk,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChannelRequest {
    Get {},
    #[serde(rename_all = "camelCase")]
    Publish {
        kind: ChannelKind,
        agent_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Retry {
        kind: ChannelKind,
        agent_id: String,
    },
    #[serde(rename_all = "camelCase")]
    SelectApprover {
        kind: ChannelKind,
        agent_id: String,
        user_id: String,
    },
}

impl ChannelRequest {
    pub fn valid(&self) -> bool {
        let id = |value: &str| {
            !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        };
        match self {
            Self::Get {} => true,
            Self::Publish { agent_id, .. } | Self::Retry { agent_id, .. } => id(agent_id),
            Self::SelectApprover {
                kind,
                agent_id,
                user_id,
            } => matches!(kind, ChannelKind::Dingtalk) && id(agent_id) && id(user_id),
        }
    }
}

pub type ChannelReply = Result<Value, &'static str>;
pub type ChannelFuture<'a> = Pin<Box<dyn Future<Output = ChannelReply> + Send + 'a>>;
pub trait ChannelHost: Send + Sync {
    fn call(&self, request: ChannelRequest) -> ChannelFuture<'_>;
}

pub(crate) async fn request(
    State(state): State<WebState>,
    body: Result<Json<ChannelRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Some(host) = state.channels.as_ref() else {
        return error(StatusCode::NOT_IMPLEMENTED, "channels_unsupported");
    };
    let Ok(Json(request)) = body else {
        return error(StatusCode::BAD_REQUEST, "operation_not_admitted");
    };
    if !request.valid() {
        return error(StatusCode::BAD_REQUEST, "operation_not_admitted");
    }
    match host.call(request).await {
        Ok(snapshot) => Json(json!({"result":snapshot,"error":null})).into_response(),
        Err(code) => error(StatusCode::SERVICE_UNAVAILABLE, code),
    }
}
