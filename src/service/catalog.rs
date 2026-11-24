use super::{Api, ApiError, App, LEGACY_SITE, Sites};
use crate::{
    config::Config,
    plugins::{Action, SiteSchedule},
    rules::digest,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fmt::Write, sync::Arc};

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(super) fn list(sites: &Sites) -> String {
    let mut html = String::new();
    if sites.entries.is_empty() {
        html.push_str("<p data-i18n=\"pairing.scriptsSection.empty\">没有已启用的站点。请到设置页管理插件。</p>");
    } else {
        html.push_str("<ul>");
        for site in sites.entries.values() {
            // The registry only accepts lowercase ASCII letters, digits and hyphens in IDs.
            write!(
                &mut html,
                "<li><a href=\"/plugins/{}/cognition-filter.user.js\"><span data-i18n=\"plugins.installScript\">安装或更新脚本</span> · {}</a> · {}</li>",
                site.id,
                escape(&site.name),
                escape(&site.script_version)
            )
            .expect("writing to String");
        }
        html.push_str("</ul>");
    }
    for error in &sites.errors {
        write!(
            &mut html,
            "<p><span data-i18n=\"catalog.loadError\">插件加载失败</span> · {}</p>",
            escape(error)
        )
        .expect("writing to String");
    }
    html
}

fn script(sites: &Sites, id: &str) -> Response {
    if let Some(site) = sites.entries.get(id) {
        (
            [("content-type", "text/javascript; charset=utf-8")],
            site.script.clone(),
        )
            .into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}
pub(super) async fn legacy_script(State(app): State<App>) -> Response {
    script(&app.sites.read(), LEGACY_SITE)
}
pub(super) async fn site_script(State(app): State<App>, Path(id): Path<String>) -> Response {
    script(&app.sites.read(), &id)
}

fn schedule_values(config: &Config, id: &str, defaults: SiteSchedule) -> (SiteSchedule, String) {
    let saved = config.site_scheduling.get(id);
    (
        saved.copied().unwrap_or(defaults),
        digest(&(id, defaults, saved)),
    )
}

fn overview(sites: &Sites, config: &Config) -> Json<Value> {
    let mut rows = Vec::new();
    let mut row = |id: &str,
                   name: &str,
                   version: &str,
                   script_version: &str,
                   file: &str,
                   defaults,
                   supports_not_interested: bool,
                   enabled| {
        let (schedule, revision) = schedule_values(config, id, defaults);
        rows.push(
            json!({"id":id,"name":name,"version":version,"scriptVersion":script_version,"file":file,"enabled":enabled,
            "autoNotInterested": supports_not_interested.then(|| config.not_interested_sites.contains(id)),
            "scheduling":schedule,"scheduleRevision":revision,"scheduleDefaults":defaults,
            "scheduleOverridden":config.site_scheduling.contains_key(id)}),
        );
    };
    for site in sites.entries.values() {
        row(
            &site.id,
            &site.name,
            &site.version,
            &site.script_version,
            &site.file,
            site.scheduling,
            site.supports_not_interested,
            true,
        );
    }
    for (id, site) in &sites.disabled {
        row(
            id,
            &site.name,
            &site.version,
            site.script_version.as_deref().unwrap_or(&site.version),
            &site.file,
            site.scheduling,
            site.supports_not_interested,
            false,
        );
    }
    rows.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    Json(json!({"plugins":rows,"errors":sites.errors}))
}

pub(super) async fn inventory(State(app): State<App>) -> Json<Value> {
    let backend = app.backend.read().await;
    overview(&app.sites.read(), &backend.config())
}

pub(super) async fn not_interested(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(p): Json<Toggle>,
) -> Api {
    let backend = app.backend.read().await;
    let directory = app.lock().store.directory().to_owned();
    let sites = app.sites.read();
    let supported = sites
        .entries
        .get(&id)
        .is_some_and(|s| s.supports_not_interested)
        || sites
            .disabled
            .get(&id)
            .is_some_and(|s| s.supports_not_interested);
    if !supported {
        return Err(super::bad("该插件不支持内容反馈"));
    }
    let mut config = backend.config();
    let mut next = config.clone();
    let changed = if p.enabled {
        next.not_interested_sites.insert(id)
    } else {
        next.not_interested_sites.remove(&id)
    };
    if changed {
        next.save(&directory).map_err(|_| {
            ApiError(
                StatusCode::INTERNAL_SERVER_ERROR,
                "本机配置文件保存失败".into(),
            )
        })?;
        *config = next;
    }
    Ok(overview(&sites, &config))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ScheduleUpdate {
    revision: String,
    // Require an explicit null for resetting to DLL defaults.
    scheduling: Value,
}
pub(super) async fn schedule(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(p): Json<ScheduleUpdate>,
) -> Api {
    let backend = app.backend.read().await;
    let directory = app.lock().store.directory().to_owned();
    let sites = app.sites.read();
    let defaults = sites
        .entries
        .get(&id)
        .map(|s| s.scheduling)
        .or_else(|| sites.disabled.get(&id).map(|s| s.scheduling))
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "未知站点插件".into()))?;
    let mut config = backend.config();
    if p.revision != schedule_values(&config, &id, defaults).1 {
        return Err(super::conflict());
    }
    let mut next = config.clone();
    if p.scheduling.is_null() {
        next.site_scheduling.remove(&id);
    } else {
        let schedule: SiteSchedule =
            serde_json::from_value(p.scheduling).map_err(|_| super::bad("站点并发配置无效"))?;
        if !schedule.valid() {
            return Err(super::bad("站点并发超出范围"));
        }
        next.site_scheduling.insert(id.clone(), schedule);
    }
    next.save(&directory).map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "本机配置文件保存失败".into(),
        )
    })?;
    *config = next;
    if let Some(gate) = backend
        .cover_slots
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
    {
        gate.send_modify(|_| {});
    }
    Ok(overview(&sites, &config))
}
async fn change(app: App, action: Option<(String, Action)>) -> Api {
    let worker = Arc::clone(&app);
    tokio::task::spawn_blocking(move || {
        worker
            .sites
            .change(action.as_ref().map(|(id, action)| (id.as_str(), *action)))
    })
    .await
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "插件管理任务中断".into()))?
    .map_err(|error| {
        ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("插件操作失败 · {error}"),
        )
    })?;
    super::queue_rule_warmup(&app);
    Ok(inventory(State(app)).await)
}
pub(super) async fn scan(State(app): State<App>) -> Api {
    change(app, None).await
}
pub(super) async fn reload(State(app): State<App>, Path(id): Path<String>) -> Api {
    change(app, Some((id, Action::Reload))).await
}
#[derive(Deserialize)]
pub(super) struct Toggle {
    enabled: bool,
}
pub(super) async fn enable(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(toggle): Json<Toggle>,
) -> Api {
    change(app, Some((id, Action::Enable(toggle.enabled)))).await
}
