use super::{Api, ApiError, App, Backend, Model, Recent, State, bad, prompt_version};
use crate::config::ConfigUpdate;
use axum::{
    Json,
    extract::rejection::JsonRejection,
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};

pub(super) fn top_level(headers: &HeaderMap) -> bool {
    !headers.contains_key("origin")
        && headers
            .get("sec-fetch-dest")
            .is_none_or(|dest| dest == "document")
}

pub(super) async fn page(State(app): State<App>, headers: HeaderMap) -> Response {
    document(&app, &headers, include_str!("../settings.html"))
}
pub(super) async fn rules_page(State(app): State<App>, headers: HeaderMap) -> Response {
    document(&app, &headers, include_str!("../rules.html"))
}
pub(super) async fn rules_script() -> impl IntoResponse {
    (
        [("content-type", "text/javascript; charset=utf-8")],
        include_str!("../rules.js"),
    )
}
pub(super) async fn stats_page(State(app): State<App>, headers: HeaderMap) -> Response {
    document(&app, &headers, include_str!("../stats.html"))
}
fn document(app: &App, headers: &HeaderMap, template: &str) -> Response {
    if !top_level(headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Html(
        template
            .replace("__PAIRING_TOKEN__", &app.settings_token)
            .replace(
                "<!-- SITE_PLUGINS -->",
                &super::catalog::list(&app.sites.read()),
            ),
    )
    .into_response()
}

pub(super) async fn script() -> impl IntoResponse {
    (
        [("content-type", "text/javascript; charset=utf-8")],
        include_str!("../settings.js"),
    )
}
pub(super) async fn stats_script() -> impl IntoResponse {
    (
        [("content-type", "text/javascript; charset=utf-8")],
        include_str!("../stats.js"),
    )
}
pub(super) async fn i18n_script() -> impl IntoResponse {
    (
        [("content-type", "text/javascript; charset=utf-8")],
        include_str!("../i18n.js"),
    )
}
pub(super) async fn pairing_script() -> impl IntoResponse {
    (
        [("content-type", "text/javascript; charset=utf-8")],
        include_str!("../pairing.js"),
    )
}
pub(super) async fn styles() -> impl IntoResponse {
    (
        [("content-type", "text/css; charset=utf-8")],
        include_str!("../settings.css"),
    )
}

fn public(backend: &Backend) -> Value {
    let mut value = backend.config().public();
    value["revision"] = json!(backend.revision);
    value
}

pub(super) async fn get_config(State(app): State<App>) -> Json<Value> {
    let backend = app.backend.read().await;
    Json(public(&backend))
}

#[derive(Deserialize)]
pub(super) struct Update {
    revision: String,
    #[serde(flatten)]
    fields: ConfigUpdate,
}

pub(super) async fn put_config(
    State(app): State<App>,
    input: Result<Json<Update>, JsonRejection>,
) -> Api {
    let Json(update) = input.map_err(|_| bad("配置请求格式无效"))?;
    // Readers retain one backend through inference and feedback. Acquire the write lock
    // before committing so an old provider cannot write stale classifications after a change.
    let mut backend = app.backend.write().await;
    if backend.revision != update.revision {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "其他窗口已更新配置，请重新载入".into(),
        ));
    }
    let next = backend.config().updated(update.fields).map_err(bad)?;
    let model = Model::from_config(&next).map_err(bad)?;
    let provider_changed = model.name != backend.model.name
        || model.endpoint != backend.model.endpoint
        || next.api_key() != backend.config().api_key();
    let mut rt = app.lock();
    next.save(rt.store.directory()).map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "本机配置文件保存失败".into(),
        )
    })?;
    // Keep upstream cooldowns and valid results when only scheduling changes.
    let mut replacement = Backend::new(
        if provider_changed {
            model
        } else {
            backend.model.clone()
        },
        next,
    );
    if provider_changed {
        rt.store.rebind_model(
            &replacement.model.name,
            &replacement.model.endpoint,
            format!("{}:{}", prompt_version(), replacement.revision),
        );
        rt.cache = Recent::default();
        rt.receipts = Recent::default();
        rt.completed = Recent::default();
    } else {
        replacement.warm_turns = backend.warm_turns.clone();
    }
    *backend = replacement;
    if provider_changed {
        super::queue_rule_warmup(&app);
    }
    let mut value = public(&backend);
    value["saved"] = json!(true);
    Ok(Json(value))
}
