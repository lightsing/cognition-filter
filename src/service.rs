use crate::{
    config::Config,
    model::{Asset, Model, prompt_version},
    plugins::{LEGACY_SITE, PluginManager, Site, Sites},
    rules::{Card, Group, Store, digest, from_flat, validate_cards, validate_groups},
};
use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use futures_util::future::join_all;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::sync::{RwLock, Semaphore};

mod discovery;
mod feedback;
mod settings;
mod statistics;
use statistics::{Ledger, Recorder};
mod catalog;
#[cfg(test)]
mod tests;

struct Recent<T>(VecDeque<(String, Instant, T)>);
impl<T> Default for Recent<T> {
    fn default() -> Self {
        Self(VecDeque::new())
    }
}
impl<T> Recent<T> {
    fn get(&self, key: &str) -> Option<&T> {
        self.0
            .iter()
            .rev()
            .find(|(k, t, _)| k == key && t.elapsed() < Duration::from_secs(86400))
            .map(|(_, _, v)| v)
    }
    fn put(&mut self, key: String, value: T) {
        self.0.retain(|(k, _, _)| k != &key);
        if self.0.len() >= 1024 {
            self.0.pop_front();
        }
        self.0.push_back((key, Instant::now(), value));
    }
}

#[derive(Clone)]
struct Receipt {
    group_ids: Vec<String>,
    cover_digest: Option<String>,
}
struct Runtime {
    store: Store,
    stats: Ledger,
    stats_save_failed: bool,
    script_version: String,
    cache: Recent<Vec<i32>>,
    receipts: Recent<Receipt>,
    completed: Recent<Value>,
}
struct Agent {
    sites: PluginManager,
    runtime: Mutex<Runtime>,
    history: Option<Ledger>,
    port: u16,
    host: String,
    port_credential: String,
    // A userscript pairing grants feed access. Configuration writes use a session token
    // supplied only in the local settings document.
    settings_token: String,
    feedback_slots: Semaphore,
    feedback_write: tokio::sync::Mutex<()>,
    backend: RwLock<Backend>,
}
struct Backend {
    model: Model,
    config: Mutex<Config>,
    revision: String,
    batches: Semaphore,
    model_slots: Semaphore,
    cover_slots: Mutex<BTreeMap<String, tokio::sync::watch::Sender<usize>>>,
    warm_turns: Arc<Mutex<BTreeMap<String, WarmSlot>>>,
}

// A DLL reload may change its limit while older downloads are draining.
struct CoverPermit(tokio::sync::watch::Sender<usize>);
impl Drop for CoverPermit {
    fn drop(&mut self) {
        self.0.send_modify(|used| *used -= 1);
    }
}

type WarmSlot = Arc<tokio::sync::Mutex<Option<WarmTurn>>>;
struct WarmTurn {
    revision: String,
    acknowledgement: String,
    retry_after: Option<Instant>,
    last_used: Instant,
}
impl Backend {
    fn new(model: Model, config: Config) -> Self {
        let limit = config.model_limit(&model.name);
        Self {
            batches: Semaphore::new(limit),
            model_slots: Semaphore::new(limit),
            cover_slots: Mutex::default(),
            warm_turns: Arc::default(),
            model,
            config: Mutex::new(config),
            revision: format!("{:032x}", fastrand::u128(..)),
        }
    }
    fn config(&self) -> MutexGuard<'_, Config> {
        self.config.lock().unwrap_or_else(|e| e.into_inner())
    }
    async fn cover_permit(&self, site: &Site) -> eyre::Result<CoverPermit> {
        let gate = self
            .cover_slots
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(site.id.clone())
            .or_insert_with(|| tokio::sync::watch::channel(0).0)
            .clone();
        let mut changes = gate.subscribe();
        loop {
            changes.borrow_and_update();
            let admitted = {
                let config = self.config();
                let limit = config.schedule(site).cover_concurrency;
                gate.send_if_modified(|used| {
                    if *used >= limit {
                        return false;
                    }
                    *used += 1;
                    true
                })
            };
            if admitted {
                break;
            }
            changes.changed().await?;
        }
        Ok(CoverPermit(gate))
    }
    async fn cover(&self, site: &Site, card: &Card) -> eyre::Result<Option<Asset>> {
        if let Some(data) = &card.page_cover {
            return Asset::from_page(data).map(Some);
        }
        if site.text_post_limit.is_some() && card.cover.is_empty() && !card.title.trim().is_empty()
        {
            return Ok(None);
        }
        let _permit = self.cover_permit(site).await?;
        self.model.cover(site, &card.cover).await.map(Some)
    }

    async fn prepare_rules(
        &self,
        app: &Agent,
        site: &str,
        settings: &crate::rules::Settings,
    ) -> String {
        let rules = &settings.rules;
        if !self.model.can_prewarm() {
            return "{}".into();
        }
        // All branches for the same cold rule turn wait for a single upstream call.
        // Keep this lock separate from the runtime and release it before visual inference.
        let slot = self
            .warm_turns
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(site.to_owned())
            .or_default()
            .clone();
        let mut turn = slot.lock().await;
        if rules.is_empty() {
            if app.lock().store.for_site(site).revision == settings.revision {
                *turn = None;
            }
            return "{}".into();
        }
        if let Some(old) = turn.as_mut()
            && old.revision == settings.revision
            && old.retry_after.map_or_else(
                || old.last_used.elapsed() < Duration::from_secs(2 * 60 * 60),
                |t| Instant::now() < t,
            )
        {
            old.last_used = Instant::now();
            return old.acknowledgement.clone();
        }
        let Ok(_slot) = self.model_slots.acquire().await else {
            return "{}".into();
        };
        if !app.sites.read().entries.contains_key(site)
            || app.lock().store.for_site(site).revision != settings.revision
        {
            return "{}".into();
        }
        app.lock().stats.site(site).warmup_calls += 1;
        let result =
            tokio::time::timeout(Duration::from_secs(4), self.model.prewarm(site, rules)).await;
        let mut rt = app.lock();
        let stats = rt.stats.site(site);
        let (ack, retry_after) = if let Ok(Ok((ack, usage))) = result {
            stats.warmup_input_tokens += usage.input;
            stats.warmup_output_tokens += usage.output;
            stats.warmup_hit_tokens += usage.cached;
            stats.add(&usage);
            (ack, None)
        } else {
            stats.warmup_failures += 1;
            ("{}".into(), Some(Instant::now() + Duration::from_secs(60)))
        };
        *turn = Some(WarmTurn {
            revision: settings.revision.clone(),
            acknowledgement: ack.clone(),
            retry_after,
            last_used: Instant::now(),
        });
        ack
    }
}

fn queue_rule_warmup(app: &App) {
    let sites = app.sites.read().entries.keys().cloned().collect();
    warm_sites(app, sites);
}
fn warm_sites(app: &App, sites: Vec<String>) {
    if sites.is_empty() {
        return;
    }
    let app = Arc::clone(app);
    tokio::spawn(async move {
        let backend = app.backend.read().await;
        join_all(sites.iter().map(|site| async {
            let settings = app.lock().store.for_site(site);
            backend.prepare_rules(&app, site, &settings).await
        }))
        .await;
    });
}
fn save_and_warm(
    app: &App,
    store: &mut Store,
    groups: Vec<Group>,
    examples: Vec<crate::rules::Example>,
) -> Result<(), ApiError> {
    let ids: Vec<_> = app.sites.read().entries.keys().cloned().collect();
    let before: Vec<_> = ids.iter().map(|id| store.for_site(id).revision).collect();
    store.save(groups, examples).map_err(store_error)?;
    let changed = ids
        .into_iter()
        .zip(before)
        .filter_map(|(site, old)| (store.for_site(&site).revision != old).then_some(site))
        .collect();
    warm_sites(app, changed);
    Ok(())
}
impl Agent {
    fn lock(&self) -> MutexGuard<'_, Runtime> {
        self.runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}
type App = Arc<Agent>;
struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"message":self.1}))).into_response()
    }
}
fn bad(e: impl std::fmt::Display) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, e.to_string())
}
fn conflict() -> ApiError {
    ApiError(StatusCode::CONFLICT, "判定或规则已变化，请重新检测".into())
}
fn busy() -> ApiError {
    ApiError(
        StatusCode::TOO_MANY_REQUESTS,
        "本地 agent 正忙，请重试".into(),
    )
}
fn store_error(_: eyre::Report) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "规则写入失败".into())
}
type Api = Result<Json<Value>, ApiError>;
const DISABLED_REVISION: &str = "site-disabled";

pub(crate) fn router_with_config(
    model: Model,
    store: Store,
    config: Config,
    port: u16,
    sites: Sites,
) -> (Router, Recorder) {
    let mut secret = [0u8; 24];
    getrandom::fill(&mut secret).expect("OS randomness unavailable");
    let history = statistics::load(store.directory())
        .inspect_err(|error| tracing::warn!(%error, "累计统计读取失败，保留原文件"))
        .ok();
    let app = Arc::new(Agent {
        sites: PluginManager::new(sites),
        history,
        port,
        host: format!("127.0.0.1:{port}"),
        port_credential: discovery::credential(&store.token, port),
        settings_token: hex::encode(secret),
        backend: RwLock::new(Backend::new(model, config)),
        runtime: Mutex::new(Runtime {
            store,
            stats: Ledger::default(),
            stats_save_failed: false,
            script_version: String::new(),
            cache: Recent::default(),
            receipts: Recent::default(),
            completed: Recent::default(),
        }),
        feedback_slots: Semaphore::new(6),
        feedback_write: tokio::sync::Mutex::new(()),
    });
    queue_rule_warmup(&app);
    let recorder = Recorder::new(app.clone());
    let router = Router::new()
        .route("/.well-known/cognition-filter", get(discovery::probe))
        .route("/", get(pairing))
        .route("/i18n.js", get(settings::i18n_script))
        .route("/pairing.js", get(settings::pairing_script))
        .route("/rules", get(settings::rules_page))
        .route("/rules.js", get(settings::rules_script))
        .route("/v1/admin/rules", get(admin_rules).put(admin_update_rules))
        .route(
            "/v1/plugins/{site}/scheduling",
            axum::routing::put(catalog::schedule),
        )
        .route("/stats", get(settings::stats_page))
        .route("/stats.js", get(settings::stats_script))
        .route("/v1/stats", get(statistics::get))
        .route("/v1/plugins", get(catalog::inventory))
        .route(
            "/v1/plugins/{site}/not-interested",
            axum::routing::put(catalog::not_interested),
        )
        .route("/v1/plugins/scan", post(catalog::scan))
        .route(
            "/v1/plugins/{site}/enabled",
            axum::routing::put(catalog::enable),
        )
        .route("/v1/plugins/{site}/reload", post(catalog::reload))
        .route("/settings", get(settings::page))
        .route("/settings.js", get(settings::script))
        .route("/settings.css", get(settings::styles))
        .route(
            "/v1/config",
            get(settings::get_config).put(settings::put_config),
        )
        .route("/cognition-filter.user.js", get(catalog::legacy_script))
        .route(
            "/plugins/{site}/cognition-filter.user.js",
            get(catalog::site_script),
        )
        .route("/v1/rules", get(rules).put(update_rules))
        .route("/v1/status", get(status))
        .route(
            "/v1/classify",
            post(classify).layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        .route("/v1/feedback", post(feedback::report))
        .route("/v1/pick", post(feedback::pick))
        .layer(DefaultBodyLimit::max(512 * 1024))
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app);
    (router, recorder)
}

async fn guard(State(app): State<App>, mut req: Request, next: Next) -> Response {
    let is_webui = matches!(req.uri().path(), "/" | "/settings" | "/stats" | "/rules");
    let h = req.headers();
    let host_ok = h.get("host").and_then(|v| v.to_str().ok()) == Some(app.host.as_str());
    let config_api = matches!(
        req.uri().path(),
        "/v1/config" | "/v1/stats" | "/v1/plugins" | "/v1/admin/rules"
    ) || req.uri().path().starts_with("/v1/plugins/");
    let foreign_config_origin = config_api
        && h.get("origin")
            .is_some_and(|origin| origin.as_bytes() != format!("http://{}", app.host).as_bytes());
    let mut response = if !host_ok || foreign_config_origin {
        StatusCode::FORBIDDEN.into_response()
    } else if req.uri().path().starts_with("/v1/") {
        let okay = {
            let mut rt = app.lock();
            let authorization = h
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            let okay = if config_api {
                authorization.strip_prefix("Bearer ").is_some_and(|actual| {
                    bool::from(app.settings_token.as_bytes().ct_eq(actual.as_bytes()))
                })
            } else {
                discovery::authorized(
                    authorization,
                    &rt.store.token,
                    &app.port_credential,
                    app.port,
                )
            };
            if okay
                && let Some(ver) = h
                    .get("x-cognition-filter-version")
                    .and_then(|v| v.to_str().ok())
                && ver.len() < 20
                && ver.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            {
                ver.clone_into(&mut rt.script_version);
            }
            okay
        };
        if okay
            && matches!(
                req.uri().path(),
                "/v1/rules" | "/v1/classify" | "/v1/feedback" | "/v1/pick"
            )
        {
            let id = h
                .get("x-cognition-filter-site")
                .map_or(Some(LEGACY_SITE), |value| value.to_str().ok());
            let (site, disabled) = {
                let sites = app.sites.read();
                (
                    id.and_then(|id| sites.entries.get(id)).cloned(),
                    id.is_some_and(|id| sites.disabled.contains_key(id)),
                )
            };
            if let Some(site) = site {
                req.extensions_mut().insert(site);
                next.run(req).await
            } else if disabled {
                match (req.method(), req.uri().path()) {
                    (&axum::http::Method::GET, "/v1/rules") => Json(json!({"siteEnabled":false,"groups":[],"rules":[],"revision":DISABLED_REVISION,"scheduling":{"batchSize":1,"browserConcurrency":1}})).into_response(),
                    (&axum::http::Method::POST, "/v1/classify") => next.run(req).await,
                    _ => ApiError(StatusCode::FORBIDDEN,"此站点已禁用".into()).into_response(),
                }
            } else {
                ApiError(StatusCode::NOT_FOUND, "此站点的插件尚未载入".into()).into_response()
            }
        } else if okay {
            next.run(req).await
        } else {
            StatusCode::UNAUTHORIZED.into_response()
        }
    } else {
        next.run(req).await
    };
    let headers = response.headers_mut();
    for (k, v) in [
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
        (
            "content-security-policy",
            if is_webui {
                "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            } else {
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            },
        ),
    ] {
        headers.insert(k, HeaderValue::from_static(v));
    }
    response
}

async fn pairing(State(app): State<App>, headers: HeaderMap) -> Response {
    if !settings::top_level(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let catalog = catalog::list(&app.sites.read());
    let token = &app.lock().store.token;
    Html(
        include_str!("pairing.html")
            .replace("__PAIR_CODE__", token)
            .replace("<!-- SITE_PLUGINS -->", &catalog),
    )
    .into_response()
}
async fn rules(
    State(app): State<App>,
    Extension(site): Extension<Arc<Site>>,
    #[cfg(windows)] notice: Option<Extension<crate::tray::UpdateNotice>>,
    #[cfg(windows)] headers: HeaderMap,
) -> Json<Value> {
    #[cfg(windows)]
    if let Some(Extension(notice)) = notice
        && headers.get("x-cognition-filter-update-prompt").is_none()
        && let Some(installed) = headers
            .get("x-cognition-filter-version")
            .and_then(|h| h.to_str().ok())
    {
        notice.for_legacy_script(&site.id, &site.name, installed, &site.script_version);
    }
    let backend = app.backend.read().await;
    settings_json(&backend, &site, &app.lock().store.for_site(&site.id))
}
fn settings_json(app: &Backend, site: &Site, settings: &crate::rules::Settings) -> Json<Value> {
    let mut v = json!(settings);
    v["scriptVersion"] = json!(site.script_version);
    if let Some(policy) = &site.page_policy {
        v["pagePolicy"] = json!(policy);
    }
    let config = app.config();
    v["autoNotInterested"] =
        json!(site.supports_not_interested && config.not_interested_sites.contains(&site.id));
    let per_tab = config
        .schedule(site)
        .browser_concurrency
        .min(config.model_limit(&app.model.name));
    v["scheduling"] = json!({"browserConcurrency":per_tab,"batchSize":config.batch_size});
    Json(v)
}
async fn status(State(app): State<App>) -> Json<Value> {
    let backend = app.backend.read().await;
    let rt = app.lock();
    let mut v = json!(rt.stats.global());
    v["scriptVersion"] = json!(rt.script_version);
    v["model"] = json!(backend.model.name);
    v["runtime"] = json!("rust");
    v["version"] = json!(env!("CARGO_PKG_VERSION"));
    v["promptVersion"] = json!(prompt_version());
    v["revision"] = json!(rt.store.settings.revision);
    v["scheduling"] = json!(*backend.config());
    v["hasApiKey"] = json!(backend.model.configured());
    Json(v)
}
#[derive(Deserialize)]
struct RulesUpdate {
    revision: Option<String>,
    groups: Option<Vec<Group>>,
    rules: Option<Vec<String>>,
}
async fn update_rules(
    State(app): State<App>,
    Extension(site): Extension<Arc<Site>>,
    Json(p): Json<RulesUpdate>,
) -> Api {
    let backend = app.backend.read().await;
    let settings = commit_rules(&app, p, Some(&site.id))?;
    Ok(settings_json(&backend, &site, &settings))
}
fn commit_rules(
    app: &App,
    p: RulesUpdate,
    site: Option<&str>,
) -> Result<crate::rules::Settings, ApiError> {
    let mut rt = app.lock();
    let current = site.map_or_else(|| rt.store.settings.clone(), |id| rt.store.for_site(id));
    if p.revision.as_ref().is_some_and(|r| r != &current.revision) {
        return Err(conflict());
    }
    if site.is_none() && p.revision.is_none() {
        return Err(bad("缺少规则版本"));
    }
    let mut groups = if let Some(groups) = p.groups {
        groups
    } else {
        from_flat(p.rules.ok_or_else(|| bad("需要规则组"))?).map_err(bad)?
    };
    if let Some(site) = site {
        // Installed scripts edit the string lists and do not carry individual switches.
        for g in &mut groups {
            if let Some(old) = rt.store.settings.groups.iter().find(|old| old.id == g.id) {
                if !old.applies_to(site) {
                    return Err(bad("该规则属于其他网站"));
                }
                g.site.clone_from(&old.site);
                g.disabled_include = old
                    .disabled_include
                    .iter()
                    .filter(|p| g.include.contains(p))
                    .cloned()
                    .collect();
                g.disabled_exclude = old
                    .disabled_exclude
                    .iter()
                    .filter(|p| g.exclude.contains(p))
                    .cloned()
                    .collect();
            } else {
                g.site = Some(site.to_owned());
            }
        }
        let mut visible = groups.into_iter();
        groups = rt
            .store
            .settings
            .groups
            .iter()
            .filter_map(|old| {
                if old.applies_to(site) {
                    visible.next()
                } else {
                    Some(old.clone())
                }
            })
            .collect();
        groups.extend(visible);
    }
    validate_groups(&groups).map_err(bad)?;
    let examples = rt.store.examples.clone();
    save_and_warm(app, &mut rt.store, groups, examples)?;
    Ok(site.map_or_else(|| rt.store.settings.clone(), |id| rt.store.for_site(id)))
}
async fn admin_rules(State(app): State<App>) -> Json<Value> {
    let settings = app.lock().store.settings.clone();
    admin_rules_json(&app, &settings)
}
fn admin_rules_json(app: &Agent, settings: &crate::rules::Settings) -> Json<Value> {
    let mut value = json!(settings);
    let sites = app.sites.read();
    value["sites"] = json!(
        sites
            .entries
            .iter()
            .map(|(id, s)| (id, &s.name))
            .chain(sites.disabled.iter().map(|(id, s)| (id, &s.name)))
            .collect::<BTreeMap<_, _>>()
    );
    Json(value)
}
async fn admin_update_rules(State(app): State<App>, Json(p): Json<RulesUpdate>) -> Api {
    Ok(admin_rules_json(&app, &commit_rules(&app, p, None)?))
}
fn card_key(site: &Site, card: &Card) -> String {
    let key = digest(&[&card.id, &card.title, &card.author, &card.cover]);
    if site.id == LEGACY_SITE {
        key
    } else {
        digest(&(&site.id, key))
    }
}
#[derive(Deserialize)]
struct Batch {
    cards: Vec<Card>,
    revision: Option<String>,
}

struct CardReview {
    codes: Vec<i32>,
    cover_digest: Option<String>,
    message: &'static str,
    missing_cover: bool,
}

async fn review_card(
    app: &Agent,
    backend: &Backend,
    settings: &crate::rules::Settings,
    rule_hash: &str,
    site: &Site,
    card: &Card,
) -> CardReview {
    let rules = &settings.rules;
    let mut review = CardReview {
        codes: vec![-1],
        cover_digest: None,
        message: "可见证据不足",
        missing_cover: false,
    };
    if rules.is_empty() {
        review.codes = vec![0];
        return review;
    }
    if !backend.model.configured() {
        review.message = "请先在托盘设置中填写 API Key";
        return review;
    }
    let Ok(asset) = backend.cover(site, card).await else {
        review.message = "封面缺失或读取失败";
        review.missing_cover = true;
        return review;
    };
    let key = digest(&(
        &site.id,
        rule_hash,
        &card.title,
        &card.author,
        asset.as_ref().map(|a| &a.digest),
    ));
    review.cover_digest = asset.as_ref().map(|a| a.digest.clone());
    {
        let mut rt = app.lock();
        if let Some(hit) = rt.cache.get(&key).cloned() {
            rt.stats.site(&site.id).cache_hits += 1;
            review.codes = hit;
            return review;
        }
    }
    let ack = backend.prepare_rules(app, &site.id, settings).await;
    let _permit = backend
        .model_slots
        .acquire()
        .await
        .expect("backend semaphore stays open");
    app.lock().stats.site(&site.id).model_calls += 1;
    match backend
        .model
        .classify(&site.id, rules, card, asset.as_ref(), &ack)
        .await
    {
        Ok((decision, usage)) => {
            let mut rt = app.lock();
            rt.stats.site(&site.id).add(&usage);
            if decision != [-1] {
                rt.cache.put(key, decision.clone());
            }
            review.codes = decision;
        }
        Err(_) => review.message = "模型请求或结果校验未完成",
    }
    review
}

#[tracing::instrument(skip_all)]
async fn classify(
    State(app): State<App>,
    site: Option<Extension<Arc<Site>>>,
    Json(batch): Json<Batch>,
) -> Api {
    let limit = site
        .as_ref()
        .map_or(8192, |s| s.text_post_limit.unwrap_or(512));
    validate_cards(&batch.cards, limit).map_err(bad)?;
    // Legacy scripts still submit individual cards after receiving an empty rule set.
    let Some(Extension(site)) = site else {
        if batch.revision.as_deref() != Some(DISABLED_REVISION) {
            return Err(conflict());
        }
        let results: Vec<_> = batch
            .cards
            .iter()
            .map(|card| json!({"id":card.id,"decision":"allow"}))
            .collect();
        return Ok(Json(
            json!({"revision": DISABLED_REVISION, "results":results}),
        ));
    };
    let backend = app.backend.read().await;
    let settings = {
        let rt = app.lock();
        let settings = rt.store.for_site(&site.id);
        if batch
            .revision
            .as_ref()
            .is_some_and(|r| r != &settings.revision)
        {
            return Err(conflict());
        }
        settings
    };
    let active: Vec<_> = settings.groups.iter().filter_map(Group::active).collect();
    let needs_model = !settings.rules.is_empty() && backend.model.configured();
    let _permit = if needs_model {
        Some(backend.batches.try_acquire().map_err(|_| busy())?)
    } else {
        None
    };
    {
        let mut rt = app.lock();
        let stats = rt.stats.site(&site.id);
        stats.batches += 1;
        stats.cards += batch.cards.len() as u64;
    }
    let rule_hash = digest(&settings.rules);
    let reviews = join_all(
        batch
            .cards
            .iter()
            .map(|card| review_card(&app, &backend, &settings, &rule_hash, &site, card)),
    )
    .await;
    let mut rt = app.lock();
    if settings.revision != rt.store.for_site(&site.id).revision {
        return Err(conflict());
    }
    let mut results = Vec::new();
    for (card, review) in batch.cards.iter().zip(reviews) {
        let fingerprint = card_key(&site, card);
        let cover_digest = review.cover_digest;
        let mut ids = review
            .codes
            .iter()
            .filter_map(|n| usize::try_from(*n).ok()?.checked_sub(1))
            .filter_map(|n| active.get(n))
            .map(|g| g.id.clone())
            .collect::<Vec<_>>();
        for ex in &rt.store.examples {
            if ex.card_key != fingerprint
                || (ex.cover_digest.is_some() && ex.cover_digest != cover_digest)
                || !active.iter().any(|g| {
                    g.id == ex.group_id
                        && (if ex.kind == "include" {
                            &g.include
                        } else {
                            &g.exclude
                        })
                        .contains(&ex.point)
                })
            {
                continue;
            }
            ids.retain(|id| id != &ex.group_id);
            if ex.kind == "include" {
                ids.push(ex.group_id.clone());
            }
        }
        let stats = rt.stats.site(&site.id);
        let result = if ids.is_empty() {
            if review.codes == [-1] {
                stats.pending += 1;
                json!({"id":card.id,"decision":"pending","message":review.message,"retryWhenCoverLoads":review.missing_cover})
            } else {
                stats.allow += 1;
                json!({"id":card.id,"decision":"allow"})
            }
        } else {
            stats.block += 1;
            for id in &ids {
                *stats.rule_hits.entry(id.clone()).or_default() += 1;
            }
            let names = active
                .iter()
                .filter(|g| ids.contains(&g.id))
                .map(|g| g.name.as_str())
                .collect::<Vec<_>>();
            json!({"id":card.id,"decision":"block","rule":names.join("、"),"matchedGroups":ids})
        };
        rt.receipts.put(
            digest(&(&settings.revision, fingerprint)),
            Receipt {
                group_ids: ids,
                cover_digest,
            },
        );
        results.push(result);
    }
    Ok(Json(
        json!({"revision":settings.revision,"results":results}),
    ))
}
