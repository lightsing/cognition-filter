use super::*;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};

use reqwest::{Client, Method};
use tempfile::TempDir;
use tokio::{
    net::TcpListener,
    sync::{Barrier, Notify},
    task::JoinHandle,
};

const CDN: &str = "https://i2.hdslb.com/bfs/archive/test.jpg";

#[tokio::test]
async fn native_site_plugin_serves_its_script_and_scopes_card_corrections() -> eyre::Result<()> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::{env::consts::DLL_EXTENSION, fs, path::Path, process::Command};
    let temp = tempfile::tempdir()?;
    let mut sites = Sites::discover(temp.path(), temp.path())?;
    sites.entries.extend(Sites::fixture().entries);
    let app = Fixture::with_sites(&[0], None, false, sites).await;
    let get = |path: &str| app.client.get(format!("{}{path}", app.url));
    let page = get("/settings").send().await?.text().await?;
    let token = page
        .split_once("name=\"cf-token\" content=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap();
    let admin = |method, path: &str| {
        app.client
            .request(method, format!("{}{path}", app.url))
            .bearer_auth(token)
    };
    let library = temp.path().join(format!("fixture.{DLL_EXTENSION}"));
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("test/plugin-fixture.rs");
    let built = Command::new("rustc")
        .args([
            "--crate-name",
            "fixture",
            "--edition=2024",
            "--crate-type=cdylib",
        ])
        .arg(&source)
        .arg("-o")
        .arg(&library)
        .output()?;
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    fs::copy(
        &library,
        temp.path().join(format!("duplicate.{DLL_EXTENSION}")),
    )?;
    fs::write(
        temp.path().join(format!("invalid.{DLL_EXTENSION}")),
        "not a library",
    )?;
    let overview: Value = admin(Method::POST, "/v1/plugins/scan")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(overview["plugins"].as_array().unwrap().len(), 2);
    assert_eq!(overview["errors"].as_array().unwrap().len(), 2);
    let plugin = |v: &Value, id: &str| {
        v["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap()
            .clone()
    };
    let sched_path = "/v1/plugins/fixture/scheduling";
    let native_action = "/v1/plugins/bilibili/not-interested";
    assert_eq!(plugin(&overview, "bilibili")["autoNotInterested"], false);
    assert!(plugin(&overview, "fixture")["autoNotInterested"].is_null());
    assert_eq!(
        app.request(Method::PUT, native_action, &json!({"enabled":true}))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    for enabled in [true, false] {
        admin(Method::PUT, native_action)
            .json(&json!({"enabled":enabled}))
            .send()
            .await?
            .error_for_status()?;
        let rules = app.ok(Method::GET, "/v1/rules", &Value::Null).await;
        assert_eq!(rules["autoNotInterested"], enabled);
        let saved: Value =
            serde_json::from_slice(&fs::read(app.data.path().join("runtime.json"))?)?;
        assert_eq!(
            saved["notInterestedSites"]
                .as_array()
                .is_some_and(|ids| ids.contains(&json!("bilibili"))),
            enabled
        );
    }
    let original_schedule = plugin(&overview, "fixture");
    let patch = json!({"revision":original_schedule["scheduleRevision"], "scheduling":{"browserConcurrency":2,"coverConcurrency":1}});
    let saved: Value = admin(Method::PUT, sched_path)
        .json(&patch)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(plugin(&saved, "fixture")["scheduling"], patch["scheduling"]);
    assert_eq!(plugin(&saved, "bilibili"), plugin(&overview, "bilibili"));
    assert_eq!(
        admin(Method::PUT, sched_path)
            .json(&patch)
            .send()
            .await?
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        Config::load(app.data.path())?.site_scheduling["fixture"].cover_concurrency,
        1
    );
    let delivery: Value = get("/v1/rules")
        .header(
            "Authorization",
            format!("CF-Port {}", discovery::credential(&app.token, app.port)),
        )
        .header("x-cognition-filter-site", "fixture")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(delivery["scheduling"]["browserConcurrency"], 2);
    let reset: Value = admin(Method::PUT, sched_path)
        .json(&json!({"revision":plugin(&saved,"fixture")["scheduleRevision"],"scheduling":null}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(plugin(&reset, "fixture"), original_schedule);
    let script = get("/plugins/fixture/cognition-filter.user.js")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    assert!(
        script.contains("https://example.test/")
            && script.contains("'X-Cognition-Filter-Site': 'fixture'")
            && !script.contains("__CF_SITE_VERSION__")
    );
    let original = get("/cognition-filter.user.js")
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    assert_eq!(
        original,
        get("/plugins/bilibili/cognition-filter.user.js")
            .send()
            .await?
            .bytes()
            .await?
    );
    assert_eq!(
        get("/plugins/missing/cognition-filter.user.js")
            .send()
            .await?
            .status(),
        StatusCode::NOT_FOUND
    );
    let settings = app.save(json!([]), &Value::Null).await;
    let mut item = card("shared-id");
    item["pageCover"] = json!(format!(
        "data:image/jpeg;base64,{}",
        STANDARD.encode(include_bytes!("../../eval/covers/control-fishing-vlog.jpg"))
    ));
    let post = |site: &str, path: &str, body: Value| {
        app.client
            .post(format!("{}{path}", app.url))
            .header(
                "Authorization",
                format!("CF-Port {}", discovery::credential(&app.token, app.port)),
            )
            .header("X-Cognition-Filter-Site", site)
            .json(&body)
            .send()
    };
    let pick =
        json!({"card":item,"revision":settings["revision"],"newGroup":group("topic","分组")});
    assert_eq!(
        post("missing", "/v1/pick", pick.clone()).await?.status(),
        StatusCode::NOT_FOUND
    );
    let edit: Value = post("fixture", "/v1/pick", pick)
        .await?
        .error_for_status()?
        .json()
        .await?;
    let cards = json!({"cards":[item],"revision":edit["revision"]});
    let own: Value = post("fixture", "/v1/classify", cards.clone())
        .await?
        .error_for_status()?
        .json()
        .await?;
    let bili_rules = app.ok(Method::GET, "/v1/rules", &Value::Null).await;
    assert_eq!(bili_rules["groups"], json!([]));
    assert_eq!(bili_rules["revision"], settings["revision"]);
    assert_eq!(
        post(
            "bilibili",
            "/v1/pick",
            json!({"card":item,"revision":bili_rules["revision"],"groupId":"topic"})
        )
        .await?
        .status(),
        StatusCode::CONFLICT
    );
    let other = app
        .ok(
            Method::POST,
            "/v1/classify",
            &json!({"cards":[item],"revision":bili_rules["revision"]}),
        )
        .await;
    assert_eq!(own["results"][0]["decision"], "block");
    assert_eq!(other["results"][0]["decision"], "allow");
    assert_eq!(app.provider.model_calls.load(SeqCst), 1);
    let enable = "/v1/plugins/fixture/enabled";
    let reload = "/v1/plugins/fixture/reload";
    let download = "/plugins/fixture/cognition-filter.user.js";
    assert_eq!(
        app.request(Method::POST, reload, &Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        admin(Method::POST, reload)
            .header("origin", "https://other.test")
            .send()
            .await?
            .status(),
        StatusCode::FORBIDDEN
    );
    assert!(
        admin(Method::PUT, enable)
            .json(&json!({"enabled":false}))
            .send()
            .await?
            .status()
            .is_success()
    );
    assert_eq!(get(download).send().await?.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        get("/cognition-filter.user.js").send().await?.status(),
        StatusCode::OK
    );
    let disabled: Value = get("/v1/rules")
        .header(
            "Authorization",
            format!("CF-Port {}", discovery::credential(&app.token, app.port)),
        )
        .header("X-Cognition-Filter-Site", "fixture")
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(disabled["siteEnabled"], false);
    assert_eq!(
        post("fixture", "/v1/pick", json!({})).await?.status(),
        StatusCode::FORBIDDEN
    );
    let bypass: Value = post(
        "fixture",
        "/v1/classify",
        json!({"cards":[item],"revision":disabled["revision"]}),
    )
    .await?
    .json()
    .await?;
    assert_eq!(bypass["results"][0]["decision"], "allow");
    assert_eq!(app.provider.model_calls.load(SeqCst), 1);

    // The duplicate is first in path order; replace that exact DLL while the server is live.
    let path = temp.path().join(format!("duplicate.{DLL_EXTENSION}"));
    fs::write(&path, b"partial update")?;
    assert_eq!(
        admin(Method::PUT, enable)
            .json(&json!({"enabled":true}))
            .send()
            .await?
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let restarted = Sites::discover(temp.path(), temp.path())?;
    assert!(
        restarted.disabled.contains_key("fixture") && !restarted.entries.contains_key("fixture")
    );
    assert!(!restarted.errors.iter().any(|e| e.starts_with("duplicate.")));
    let built = Command::new("rustc")
        .args([
            "--crate-name",
            "fixture",
            "--edition=2024",
            "--crate-type=cdylib",
            "--cfg",
            "plugin_v2",
        ])
        .arg(&source)
        .arg("-o")
        .arg(&path)
        .output()?;
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let updated: Value = admin(Method::POST, reload)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let row = updated["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == "fixture")
        .unwrap();
    assert_eq!(row["version"], "2.0");
    assert_eq!(
        row["scheduling"],
        json!({"coverConcurrency":7,"browserConcurrency":3})
    );
    assert_eq!(row["enabled"], false);
    admin(Method::PUT, enable)
        .json(&json!({"enabled":true}))
        .send()
        .await?
        .error_for_status()?;
    assert!(
        get(download)
            .send()
            .await?
            .text()
            .await?
            .contains("@version 2.0")
    );
    fs::write(&path, b"broken")?;
    assert_eq!(
        admin(Method::POST, reload).send().await?.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert!(
        get(download)
            .send()
            .await?
            .text()
            .await?
            .contains("@version 2.0")
    );
    fs::copy(&library, &path)?;
    admin(Method::POST, reload)
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(get(download).send().await?.text().await?, script);
    Ok(())
}

#[tokio::test]
async fn tray_settings_require_the_admin_token_and_persist_without_returning_the_key() {
    let fixture = Fixture::new(&[0]).await;
    let page = fixture
        .client
        .get(format!("{}/settings", fixture.url))
        .send()
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
    assert!(
        page.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'")
    );
    let html = page.text().await.unwrap();
    let token = html
        .split_once("name=\"cf-token\" content=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap();
    assert_ne!(token, fixture.token);
    let pairing = fixture
        .client
        .get(format!("{}/", fixture.url))
        .send()
        .await
        .unwrap();
    assert!(
        pairing.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("script-src 'self'")
    );
    let pairing = pairing.text().await.unwrap();
    assert!(pairing.contains(&fixture.token) && !pairing.contains(token));
    assert!(pairing.contains("/plugins/bilibili/cognition-filter.user.js"));
    for asset in ["/i18n.js", "/pairing.js", "/settings.js", "/stats.js"] {
        let response = fixture
            .client
            .get(format!("{}{asset}", fixture.url))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response.headers()["content-type"]
                .to_str()
                .unwrap()
                .starts_with("text/javascript")
        );
    }
    let url = format!("{}/v1/config", fixture.url);
    let call = |method| fixture.client.request(method, &url).bearer_auth(token);
    assert_eq!(
        fixture
            .request(Method::GET, "/v1/config", &Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let initial: Value = call(Method::GET)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(initial["hasApiKey"], false);
    let change =
        json!({"revision":initial["revision"], "apiKey":"fixture-config-secret", "batchSize":2});
    let wrong_origin = format!("http://127.0.0.1:{}", fixture.port.wrapping_add(1));
    assert_eq!(
        call(Method::GET)
            .header("origin", &wrong_origin)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(Method::PUT)
            .header("origin", wrong_origin)
            .json(&change)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let saved = call(Method::PUT)
        .header("origin", &fixture.url)
        .json(&change)
        .send()
        .await
        .unwrap();
    assert_eq!(saved.status(), StatusCode::OK);
    let saved: Value = saved.json().await.unwrap();
    assert_eq!(saved["saved"], true);
    assert_eq!(saved["hasApiKey"], true);
    assert_eq!(saved["batchSize"], 1);
    assert_eq!(
        fixture.ok(Method::GET, "/v1/rules", &Value::Null).await["scheduling"]["batchSize"],
        1
    );
    assert!(!saved.to_string().contains("fixture-config-secret"));
    assert!(saved.get("apiKey").is_none());
    let loaded = Config::load(fixture.data.path()).unwrap();
    assert_eq!(loaded.api_key(), "fixture-config-secret");
    assert_eq!(loaded.batch_size, 1);
    assert_eq!(
        call(Method::PUT)
            .json(&change)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(Method::PUT)
            .json(&json!({"revision":saved["revision"], "batchSize":0}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(Config::load(fixture.data.path()).unwrap().batch_size, 1);
    let fetched: Value = call(Method::GET)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(fetched["revision"], saved["revision"]);
    assert!(!fetched.to_string().contains("fixture-config-secret"));
    let embedded = fixture
        .client
        .get(format!("{}/settings", fixture.url))
        .header("sec-fetch-dest", "iframe")
        .send()
        .await
        .unwrap();
    assert_eq!(embedded.status(), StatusCode::FORBIDDEN);
}

#[derive(Default)]
struct Provider {
    recorded_turns: Mutex<Vec<Vec<Value>>>,
    reject_warm: AtomicBool,
    decisions: Mutex<Vec<i32>>,
    cover_calls: AtomicUsize,
    model_calls: AtomicUsize,
    reflections: AtomicUsize,
    changed_cover: AtomicBool,
    hold_reflection: AtomicBool,
    entered: Notify,
    release: Notify,
    classification_gate: Mutex<Option<Arc<Barrier>>>,
    model_entered: Notify,
}

async fn cover(State(p): State<Arc<Provider>>) -> Response {
    p.cover_calls.fetch_add(1, SeqCst);
    let bytes: &[u8] = if p.changed_cover.load(SeqCst) {
        include_bytes!("../../eval/covers/teams.png")
    } else {
        include_bytes!("../../eval/covers/cooking.png")
    };
    ([("content-type", "image/png")], bytes).into_response()
}

async fn completion(State(p): State<Arc<Provider>>, Json(request): Json<Value>) -> Json<Value> {
    let messages = request["messages"].as_array().unwrap();
    if request.get("thinking").is_some() {
        p.recorded_turns.lock().unwrap().push(messages.clone());
        if messages.last().unwrap()["content"].is_string() {
            tokio::time::sleep(Duration::from_millis(60)).await;
            if p.reject_warm.load(SeqCst) {
                return Json(json!({"error":"unavailable"}));
            }
            return Json(
                json!({"choices":[{"finish_reason":"stop","message":{"content":"{ }"}}],
                "usage":{"prompt_tokens":400,"completion_tokens":2,"prompt_cache_hit_tokens":128}}),
            );
        }
    }
    p.model_calls.fetch_add(1, SeqCst);
    let parts = request["messages"].as_array().unwrap().last().unwrap()["content"]
        .as_array()
        .unwrap();
    let metadata = serde_json::from_str::<Value>(parts[0]["text"].as_str().unwrap()).ok();
    let content = if let Some(groups) = metadata.as_ref().and_then(|v| v["groups"].as_array()) {
        p.reflections.fetch_add(1, SeqCst);
        if p.hold_reflection.load(SeqCst) {
            p.entered.notify_one();
            p.release.notified().await;
        }
        let corrections = groups
            .iter()
            .map(|g| json!({"groupId":g["id"],"point":"封面逐步展示原始实验过程"}))
            .collect::<Vec<_>>();
        json!({"reason":"此前忽略了实验过程","corrections":corrections})
    } else {
        let gate = p.classification_gate.lock().unwrap().clone();
        if let Some(gate) = gate {
            p.model_entered.notify_one();
            gate.wait().await;
        }
        let count = parts
            .iter()
            .filter(|part| part["type"] == "image_url")
            .count();
        let decisions = p.decisions.lock().unwrap().clone();
        let decision = if decisions.len() == 1 {
            json!(decisions[0])
        } else {
            json!(decisions)
        };
        json!({"v":vec![decision;count.max(1)]})
    };
    Json(json!({
        "choices":[{"finish_reason":"stop","message":{"content":content.to_string()}}],
        "usage":{"prompt_tokens":20,"completion_tokens":4}
    }))
}

async fn serve(build_router: impl FnOnce(u16) -> Router) -> (String, u16, JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = build_router(address.port());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), address.port(), task)
}

struct Fixture {
    data: TempDir,
    provider: Arc<Provider>,
    client: Client,
    url: String,
    port: u16,
    token: String,
    tasks: [JoinHandle<()>; 2],
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

impl Fixture {
    async fn new(labels: &[i32]) -> Self {
        Self::with_config(labels, None).await
    }

    async fn with_config(labels: &[i32], runtime: Option<Value>) -> Self {
        Self::start(labels, runtime, false).await
    }
    async fn start(labels: &[i32], runtime: Option<Value>, deepseek: bool) -> Self {
        Self::with_sites(labels, runtime, deepseek, Sites::fixture()).await
    }
    async fn with_sites(
        labels: &[i32],
        runtime: Option<Value>,
        deepseek: bool,
        sites: Sites,
    ) -> Self {
        let provider = Arc::new(Provider::default());
        *provider.decisions.lock().unwrap() = labels.to_vec();
        let upstream = Router::new()
            .route("/cover", get(cover))
            .route("/chat/completions", post(completion))
            .with_state(provider.clone());
        let (base, _, upstream_task) = serve(|_| upstream).await;
        let model = Model::fixture(&base, deepseek).unwrap();
        let data = tempfile::tempdir().unwrap();
        let store =
            Store::load(data.path(), &model.name, &model.endpoint, prompt_version()).unwrap();
        let token = store.token.clone();
        let config = if let Some(mut runtime) = runtime {
            runtime["model"] = json!(model.name);
            runtime["endpoint"] = json!(base);
            runtime["apiKey"] = json!("");
            std::fs::write(
                data.path().join("runtime.json"),
                serde_json::to_vec(&runtime).unwrap(),
            )
            .unwrap();
            Config::load(data.path()).unwrap()
        } else {
            Config::default()
        };
        let (url, port, agent_task) =
            serve(|port| router_with_config(model, store, config, port, sites).0).await;
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap();
        Self {
            data,
            provider,
            client,
            url,
            port,
            token,
            tasks: [upstream_task, agent_task],
        }
    }

    async fn request(&self, method: Method, path: &str, body: &Value) -> (StatusCode, Value) {
        let mut req = self
            .client
            .request(method, format!("{}{path}", self.url))
            .header(
                "authorization",
                format!("CF-Port {}", discovery::credential(&self.token, self.port)),
            );
        if !body.is_null() {
            req = req.json(body);
        }
        let res = req.send().await.unwrap();
        let status = res.status();
        let bytes = res.bytes().await.unwrap();
        let data = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, data)
    }

    async fn ok(&self, method: Method, path: &str, body: &Value) -> Value {
        let (status, data) = self.request(method, path, body).await;
        assert_eq!(status, StatusCode::OK, "{path} {data}");
        data
    }

    async fn save(&self, groups: Value, revision: &Value) -> Value {
        self.ok(
            Method::PUT,
            "/v1/rules",
            &json!({"groups":groups, "revision":revision}),
        )
        .await
    }

    async fn verdict(&self, id: &str, revision: &Value) -> Value {
        self.ok(
            Method::POST,
            "/v1/classify",
            &json!({"cards":[card(id)],"revision":revision}),
        )
        .await["results"][0]
            .clone()
    }
}

fn card(id: &str) -> Value {
    json!({"id":id,"title":"一次有趣的实验","author":"老师","cover":CDN})
}

fn group(id: &str, name: &str) -> Value {
    json!({"id":id,"name":name,"enabled":true,"include":["已有命中要点"],"exclude":[]})
}

#[tokio::test]
async fn saturated_cover_pool_leaves_other_sites_free() -> eyre::Result<()> {
    let mut a = Sites::fixture().entries.remove(LEGACY_SITE).unwrap();
    let mut b = Sites::fixture().entries.remove(LEGACY_SITE).unwrap();
    Arc::get_mut(&mut a).unwrap().scheduling.cover_concurrency = 1;
    let other = Arc::get_mut(&mut b).unwrap();
    other.id = "other".into();
    other.scheduling.cover_concurrency = 2;
    let backend = Backend::new(
        Model::fixture("http://127.0.0.1:1", false)?,
        Config::default(),
    );
    let first = backend.cover_permit(&a).await?;
    let second = backend.cover_permit(&a);
    tokio::pin!(second);
    assert!(
        tokio::time::timeout(Duration::from_millis(25), &mut second)
            .await
            .is_err()
    );
    let (_other_one, _other_two) = tokio::time::timeout(Duration::from_secs(1), async {
        tokio::try_join!(backend.cover_permit(&b), backend.cover_permit(&b))
    })
    .await??;
    drop(first);
    tokio::time::timeout(Duration::from_secs(1), second).await??;
    Ok(())
}

#[tokio::test]
async fn point_switches_control_prompts_and_survive_legacy_group_writes() -> eyre::Result<()> {
    let f = Fixture::new(&[0]).await;
    let page = f
        .client
        .get(format!("{}/rules", f.url))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let token = page
        .split_once("name=\"cf-token\" content=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap();
    let url = format!("{}/v1/admin/rules", f.url);
    let admin = |m| f.client.request(m, &url).bearer_auth(token);
    let rev = admin(Method::GET).send().await?.json::<Value>().await?["revision"].clone();
    assert_eq!(
        f.request(Method::GET, "/v1/admin/rules", &Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let mut g = group("test", "一组");
    g["include"] = json!(["甲", "乙"]);
    g["exclude"] = json!(["丙", "丁"]);
    g["disabledInclude"] = json!(["甲"]);
    g["disabledExclude"] = json!(["丁"]);
    let body = json!({"revision":rev,"groups":[g]});
    let v: Value = admin(Method::PUT)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(v["rules"], json!(["一组。乙。保留丙。"]));
    assert_eq!(
        admin(Method::PUT).json(&body).send().await?.status(),
        StatusCode::CONFLICT
    );
    let mut legacy = g.clone();
    legacy.as_object_mut().unwrap().remove("disabledInclude");
    legacy.as_object_mut().unwrap().remove("disabledExclude");
    legacy["name"] = json!("编辑");
    let kept = f.save(json!([legacy]), &v["revision"]).await;
    assert_eq!(kept["groups"][0]["disabledInclude"], json!(["甲"]));
    assert_eq!(kept["groups"][0]["disabledExclude"], json!(["丁"]));
    g["disabledInclude"] = json!(["乙", "甲"]);
    let off = admin(Method::PUT)
        .json(&json!({"revision":kept["revision"],"groups":[g]}))
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?;
    assert_eq!(off["rules"], json!([]));
    let result = f
        .ok(
            Method::POST,
            "/v1/classify",
            &json!({"revision":off["revision"],"cards":[card("paused")]}),
        )
        .await;
    assert_eq!(result["results"][0]["decision"], "allow");
    assert_eq!(f.provider.model_calls.load(SeqCst), 0);
    Ok(())
}

#[tokio::test]
async fn rule_edits_rewarm_each_affected_site_without_a_card() -> eyre::Result<()> {
    let mut sites = Sites::fixture();
    let mut other = Arc::into_inner(Sites::fixture().entries.remove("bilibili").unwrap()).unwrap();
    other.id = "second".into();
    sites.entries.insert(other.id.clone(), Arc::new(other));
    let app = Fixture::with_sites(&[0], None, true, sites).await;
    async fn await_warm(app: &Fixture, count: u64) {
        tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                let status = app.ok(Method::GET, "/v1/status", &Value::Null).await;
                if status["warmupInputTokens"] == count * 400 {
                    assert_eq!(status["warmupCalls"], count);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(15)).await;
            }
        })
        .await
        .unwrap();
    }
    await_warm(&app, 2).await;
    let mut rules = app.ok(Method::GET, "/v1/rules", &Value::Null).await;
    rules["groups"][2]["include"][0] = json!("本站专属变更");
    let edited = app.save(rules["groups"].clone(), &rules["revision"]).await;
    await_warm(&app, 3).await;
    let mut groups = edited["groups"].clone();
    groups[0]["include"][0] = json!("所有站点共享变更");
    app.save(groups, &edited["revision"]).await;
    await_warm(&app, 5).await;
    for site in ["second", "bilibili", "bilibili"] {
        let response: Value = app
            .client
            .post(format!("{}/v1/classify", app.url))
            .header(
                "authorization",
                format!("CF-Port {}", discovery::credential(&app.token, app.port)),
            )
            .header("X-Cognition-Filter-Site", site)
            .json(&json!({"cards":[card("stats")]}))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        assert_eq!(response["results"][0]["decision"], "allow");
    }
    let page = app
        .client
        .get(format!("{}/stats", app.url))
        .send()
        .await?
        .text()
        .await?;
    let token = page
        .split_once("name=\"cf-token\" content=\"")
        .unwrap()
        .1
        .split('"')
        .next()
        .unwrap();
    let stats: Value = app
        .client
        .get(format!("{}/v1/stats", app.url))
        .bearer_auth(token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    for (id, cards, warmups, hits) in [("bilibili", 2, 3, 1), ("second", 1, 2, 0)] {
        let row = &stats["bySite"]["session"][id];
        assert_eq!(row["cards"], cards);
        assert_eq!(row["cacheHits"], hits);
        assert_eq!(row["warmupCalls"], warmups);
        assert_eq!(row["inputTokens"], warmups * 400 + 20);
        assert_eq!(row["outputTokens"], warmups * 2 + 4);
        assert_eq!(row["prefixHitTokens"], warmups * 128);
    }
    assert_eq!(stats["session"]["cards"], 3);
    assert_eq!(stats["session"]["inputTokens"], 2040);
    let turns = app.provider.recorded_turns.lock().unwrap();
    let last = turns[3..5]
        .iter()
        .map(|seq| seq[1]["content"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(last.iter().all(|t| t.contains("所有站点共享变更")));
    assert!(
        last.iter()
            .any(|t| t.starts_with("站点 bilibili\n") && t.contains("本站专属变更"))
    );
    assert!(
        last.iter()
            .any(|t| t.starts_with("站点 second\n") && !t.contains("本站专属变更"))
    );
    assert_eq!(
        last.iter().filter(|t| t.contains("本站专属变更")).count(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn parallel_reviews_branch_from_one_rule_turn_and_recover_from_failed_warmup() {
    let app = Fixture::start(&[0], None, true).await;
    let branch = |id: &str| {
        let mut item = card(id);
        item["title"] = json!(id);
        json!({"cards":[item]})
    };
    let (a, b) = (branch("batch-A"), branch("batch-B"));
    // A legacy client can still submit both cards together. The upstream calls must
    // reach this barrier concurrently, with only the shared rule turn in common.
    *app.provider.classification_gate.lock().unwrap() = Some(Arc::new(Barrier::new(2)));
    let both = json!({"cards":[a["cards"][0], b["cards"][0]]});
    let response = tokio::time::timeout(
        Duration::from_secs(5),
        app.ok(Method::POST, "/v1/classify", &both),
    )
    .await
    .unwrap();
    *app.provider.classification_gate.lock().unwrap() = None;
    for (row, id) in response["results"]
        .as_array()
        .unwrap()
        .iter()
        .zip(["batch-A", "batch-B"])
    {
        assert_eq!(row["id"], id);
        assert_eq!(row["decision"], "allow");
    }
    {
        let calls = app.provider.recorded_turns.lock().unwrap();
        assert_eq!(calls.len(), 3);
        let prefix = &calls[0];
        assert_eq!(prefix.len(), 2);
        assert!(prefix.iter().all(|m| m["content"].is_string()));
        for messages in &calls[1..] {
            assert_eq!(&messages[..2], &prefix[..]);
            assert_eq!(messages[2], json!({"role":"assistant","content":"{ }"}));
            assert_eq!(messages.len(), 4);
            assert_eq!(messages[3]["content"].as_array().unwrap().len(), 2);
        }
        assert_ne!(calls[1][3], calls[2][3]);
    }
    let status = app.ok(Method::GET, "/v1/status", &Value::Null).await;
    assert_eq!(status["warmupCalls"], 1);
    assert_eq!(status["warmupInputTokens"], 400);
    assert_eq!(status["warmupHitTokens"], 128);
    assert_eq!(status["inputTokens"], 440);
    app.provider.reject_warm.store(true, SeqCst);
    app.save(json!([group("new", "修改后的规则")]), &status["revision"])
        .await;
    for id in ["batch-C", "batch-D"] {
        let reply = app.ok(Method::POST, "/v1/classify", &branch(id)).await;
        assert_eq!(reply["results"][0]["decision"], "allow");
    }
    let status = app.ok(Method::GET, "/v1/status", &Value::Null).await;
    assert_eq!(status["warmupCalls"], 2);
    assert_eq!(status["warmupFailures"], 1);
    let calls = app.provider.recorded_turns.lock().unwrap();
    assert_eq!(calls.len(), 6);
    assert_ne!(calls[0][1], calls[3][1]);
    assert_eq!(calls[4][1], calls[3][1]);
    assert_eq!(calls[5][2]["content"], "{}");
}

#[tokio::test]
async fn discovery_requires_exact_host_and_nonce_and_credentials_are_scoped_to_the_port() {
    let fixture = Fixture::new(&[0]).await;
    let nonce = "00112233445566778899aabbccddeeff";
    let endpoint = format!("{}/.well-known/cognition-filter", fixture.url);
    let url = format!("{endpoint}?nonce={nonce}");
    let response = fixture.client.get(&url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let data: Value = response.json().await.unwrap();
    assert_eq!(data.as_object().unwrap().len(), 4);
    assert_eq!(data["service"], "cognition-filter");
    assert_eq!(data["protocol"], 1);
    assert_eq!(data["port"], fixture.port);
    assert_eq!(data["proof"].as_str().unwrap().len(), 64);
    assert!(!data.to_string().contains(&fixture.token));
    let another: Value = fixture
        .client
        .get(format!("{endpoint}?nonce={}", "f".repeat(32)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_ne!(another["proof"], data["proof"]);
    for query in [
        "",
        "?nonce=0",
        "?nonce=00112233445566778899AABBCCDDEEFF",
        "?nonce=00112233445566778899aabbccddeeff&nonce=x",
    ] {
        assert_eq!(
            fixture
                .client
                .get(format!("{endpoint}{query}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let wrong_port = fixture.port.wrapping_add(1);
    for host in [
        format!("localhost:{}", fixture.port),
        format!("127.0.0.1:{wrong_port}"),
    ] {
        assert_eq!(
            fixture
                .client
                .get(&url)
                .header("host", &host)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            fixture
                .client
                .get(&fixture.url)
                .header("host", &host)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    let status = format!("{}/v1/status", fixture.url);
    let wrong = discovery::credential(&fixture.token, wrong_port);
    for auth in [
        format!("CF-Port {wrong}"),
        format!("CF-Port {}", data["proof"].as_str().unwrap()),
        format!("Bearer {}", fixture.token),
    ] {
        assert_eq!(
            fixture
                .client
                .get(&status)
                .header("authorization", auth)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        fixture.ok(Method::GET, "/v1/status", &Value::Null).await["runtime"],
        "rust"
    );
}

#[tokio::test]
async fn discovery_responds_within_client_deadline_while_inference_is_stalled() {
    let fixture = Fixture::new(&[0]).await;
    let gate = Arc::new(Barrier::new(2));
    *fixture.provider.classification_gate.lock().unwrap() = Some(gate.clone());
    let batch = json!({"cards":[card("slow-model")]});
    let inference = fixture.request(Method::POST, "/v1/classify", &batch);
    let probe = async {
        tokio::time::timeout(
            Duration::from_secs(4),
            fixture.provider.model_entered.notified(),
        )
        .await
        .unwrap();
        let response = fixture
            .client
            .get(format!(
                "{}/.well-known/cognition-filter?nonce=00000000000000000000000000000000",
                fixture.url
            ))
            .timeout(Duration::from_millis(700))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        gate.wait().await;
    };
    let ((status, _), ()) = tokio::join!(inference, probe);
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn duplicate_feedback_and_later_edits_respect_the_card_image_and_corrected_group() {
    let app = Fixture::new(&[1, 2]).await;
    let settings = app
        .save(
            json!([group("a", "第一组"), group("b", "第二组")]),
            &Value::Null,
        )
        .await;
    let action = json!({"card":card("same"),"revision":settings["revision"]});
    assert_eq!(
        app.request(Method::POST, "/v1/feedback", &action).await.0,
        StatusCode::CONFLICT
    );
    let first = app.verdict("same", &settings["revision"]).await;
    assert_eq!(first["rule"], "第一组、第二组");
    let status = app.ok(Method::GET, "/v1/status", &Value::Null).await;
    assert_eq!(status["block"], 1);
    assert_eq!(status["ruleHits"], json!({"a":1,"b":1}));
    let (saved, repeat) = tokio::join!(
        app.ok(Method::POST, "/v1/feedback", &action),
        app.ok(Method::POST, "/v1/feedback", &action)
    );
    assert_eq!(saved, repeat);
    assert_eq!(
        app.ok(Method::GET, "/v1/status", &Value::Null).await["reported"],
        1
    );
    assert_eq!(saved["corrections"].as_array().unwrap().len(), 2);
    assert_eq!(app.provider.reflections.load(SeqCst), 1);
    assert_eq!(
        app.verdict("same", &saved["revision"]).await["decision"],
        "allow"
    );
    assert_eq!(
        app.verdict("different", &saved["revision"]).await["decision"],
        "block"
    );
    app.provider.changed_cover.store(true, SeqCst);
    assert_eq!(
        app.verdict("same", &saved["revision"]).await["decision"],
        "block"
    );
    app.provider.changed_cover.store(false, SeqCst);
    let mut groups = app.ok(Method::GET, "/v1/rules", &Value::Null).await["groups"].clone();
    groups[0]["exclude"] = json!(["用户写的新例外"]);
    let edited = app.save(groups, &saved["revision"]).await;
    let v = app.verdict("same", &edited["revision"]).await;
    assert_eq!(v["decision"], "block");
    assert_eq!(v["rule"], "第一组");
}

#[tokio::test]
async fn concurrent_edit_survives_feedback_in_flight_without_partial_writes() {
    let app = Fixture::new(&[1]).await;
    let settings = app.save(json!([group("a", "原组")]), &Value::Null).await;
    app.verdict("race", &settings["revision"]).await;
    app.provider.hold_reflection.store(true, SeqCst);
    let action = json!({"card":card("race"),"revision":settings["revision"]});
    let feedback = app.request(Method::POST, "/v1/feedback", &action);
    let edit = async {
        tokio::time::timeout(Duration::from_secs(4), app.provider.entered.notified())
            .await
            .unwrap();
        let mut groups = settings["groups"].clone();
        groups[0]["exclude"] = json!(["人工编辑"]);
        let saved = app.save(groups, &settings["revision"]).await;
        app.provider.release.notify_one();
        saved
    };
    let ((status, _), saved) = tokio::join!(feedback, edit);
    assert_eq!(status, StatusCode::CONFLICT);
    let reloaded = app.ok(Method::GET, "/v1/rules", &Value::Null).await;
    for field in ["groups", "rules", "revision"] {
        assert_eq!(reloaded[field], saved[field]);
    }
    let bytes = std::fs::read(app.data.path().join("rules.json")).unwrap();
    let disk: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(disk["groups"], saved["groups"]);
    assert_eq!(disk["examples"], json!([]));
}

#[tokio::test]
async fn explicit_new_group_needs_no_upstream_and_removed_points_revoke_picks() {
    let app = Fixture::new(&[0]).await;
    let settings = app.save(json!([]), &Value::Null).await;
    let mut new_group = group("user", "我的新组");
    new_group["include"] = json!(["  已有命中要点  "]);
    let action = json!({"card":card("pick"),"revision":settings["revision"],"newGroup":new_group});
    let result = app.ok(Method::POST, "/v1/pick", &action).await;
    assert_eq!(result["corrections"][0]["groupName"], "我的新组");
    assert_eq!(app.ok(Method::POST, "/v1/pick", &action).await, result);
    assert_eq!(
        app.ok(Method::GET, "/v1/status", &Value::Null).await["picked"],
        1
    );
    assert_eq!(app.provider.cover_calls.load(SeqCst), 0);
    assert_eq!(app.provider.model_calls.load(SeqCst), 0);
    assert_eq!(
        app.verdict("pick", &result["revision"]).await["rule"],
        "我的新组"
    );
    let mut groups = app.ok(Method::GET, "/v1/rules", &Value::Null).await["groups"].clone();
    groups[0]["include"] = json!(["改成其他条件"]);
    let edited = app.save(groups, &result["revision"]).await;
    assert_eq!(
        app.verdict("pick", &edited["revision"]).await["decision"],
        "allow"
    );
    let pick = json!({"card":card("pick"),"revision":edited["revision"],"groupId":"user"});
    let trained = app.ok(Method::POST, "/v1/pick", &pick).await;
    assert_eq!(app.provider.reflections.load(SeqCst), 1);
    assert_eq!(app.ok(Method::POST, "/v1/pick", &pick).await, trained);
    assert_eq!(
        app.verdict("pick", &trained["revision"]).await["rule"],
        "我的新组"
    );
}

#[tokio::test]
async fn x_text_only_reviews_and_reflections_use_no_cover() -> eyre::Result<()> {
    let sites = Sites::fixture_for(
        include_str!("../../plugins/x/site.json"),
        include_str!("../../plugins/x/x.user.js"),
    );
    let f = Fixture::with_sites(&[1], None, true, sites).await;
    let request = |method, path: &str| {
        f.client
            .request(method, format!("{}{path}", f.url))
            .header(
                "authorization",
                format!("CF-Port {}", discovery::credential(&f.token, f.port)),
            )
            .header("X-Cognition-Filter-Site", "x")
    };
    let rules: Value = request(Method::GET, "/v1/rules")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(rules["groups"].as_array().unwrap().len(), 2);
    let card = json!({"id":"12345","title":"纯文字帖子".repeat(140),"author":"读者 @reader"});
    let result: Value = request(Method::POST, "/v1/classify")
        .json(&json!({"cards":[card],"revision":rules["revision"]}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(result["results"][0]["decision"], "block");
    request(Method::POST, "/v1/feedback")
        .json(&json!({"card":card,"revision":rules["revision"]}))
        .send()
        .await?
        .error_for_status()?;
    assert_eq!(f.provider.cover_calls.load(SeqCst), 0);
    assert_eq!(f.provider.reflections.load(SeqCst), 1);
    let turns = f.provider.recorded_turns.lock().unwrap();
    let parts = turns
        .iter()
        .find_map(|turn| turn.get(3).and_then(|m| m["content"].as_array()))
        .unwrap();
    assert_eq!(parts.len(), 1);
    assert!(parts[0]["text"].as_str().unwrap().contains("纯文字帖子"));
    Ok(())
}

#[tokio::test]
async fn supplied_page_image_serves_classification_and_feedback_without_cover_fetch() {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let app = Fixture::new(&[1]).await;
    let mut item = card("from-page");
    item["title"] = json!("");
    let bytes = include_bytes!("../../eval/covers/control-fishing-vlog.jpg");
    item["pageCover"] = json!(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
    let answer = app
        .ok(Method::POST, "/v1/classify", &json!({"cards":[item]}))
        .await;
    assert_eq!(answer["results"][0]["decision"], "block");
    app.ok(
        Method::POST,
        "/v1/feedback",
        &json!({"card":item,"revision":answer["revision"]}),
    )
    .await;
    assert_eq!(app.provider.reflections.load(SeqCst), 1);
    assert_eq!(app.provider.cover_calls.load(SeqCst), 0);
}

#[tokio::test]
async fn local_pairing_is_required_and_an_unreadable_cover_stays_masked() {
    let app = Fixture::new(&[0]).await;
    for route in ["/v1/feedback", "/v1/pick"] {
        let response = app
            .client
            .post(format!("{}{route}", app.url))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let status = app.ok(Method::GET, "/v1/status", &Value::Null).await;
    assert_eq!(status["runtime"], "rust");
    let mut card = card("offline");
    card["cover"] = json!("");
    let res = app
        .ok(
            Method::POST,
            "/v1/classify",
            &json!({"cards":[card],"revision":status["revision"]}),
        )
        .await;
    assert_eq!(res["results"][0]["decision"], "pending");
    assert_eq!(app.provider.model_calls.load(SeqCst), 0);
    assert_eq!(app.provider.cover_calls.load(SeqCst), 0);
}

#[tokio::test]
async fn concurrent_card_requests_reach_the_model_together_and_reject_overflow_before_cover_download()
 {
    for (model_limit, provider_limit, expected) in [(1, 5, 1), (5, 3, 3), (3, 5, 3)] {
        let runtime = json!({
            "providerLimits":{"test-vision":provider_limit},
            "modelConcurrency":model_limit,"coverConcurrency":4,"browserConcurrency":3,"batchSize":1
        });
        let app = Fixture::with_config(&[0], Some(runtime.clone())).await;
        let status = app.ok(Method::GET, "/v1/status", &Value::Null).await;
        assert_eq!(status["scheduling"]["modelConcurrency"], model_limit);
        assert_eq!(
            status["scheduling"]["providerLimits"],
            runtime["providerLimits"]
        );
        assert_eq!(
            status["scheduling"]["siteScheduling"]["bilibili"],
            json!({"browserConcurrency":3,"coverConcurrency":4})
        );
        let rules = app.ok(Method::GET, "/v1/rules", &Value::Null).await;
        assert_eq!(
            rules["scheduling"],
            json!({"browserConcurrency":expected.min(3_usize),"batchSize":1})
        );
        let gate = Arc::new(Barrier::new(expected + 1));
        *app.provider.classification_gate.lock().unwrap() = Some(gate.clone());
        let payloads: Vec<_> = (0..expected)
            .map(|index| {
                let id = format!("batch-{index}");
                let mut card = card(&id);
                card["title"] = json!(id);
                json!({"cards":[card],"revision":rules["revision"]})
            })
            .collect();
        let admitted = join_all(
            payloads
                .iter()
                .map(|body| app.request(Method::POST, "/v1/classify", body)),
        );
        let overflow = async {
            tokio::time::timeout(Duration::from_secs(4), async {
                while app.provider.model_calls.load(SeqCst) < expected {
                    app.provider.model_entered.notified().await;
                }
            })
            .await
            .expect("all configured model slots should be active at the same time");
            let extra = json!({"cards":[card("excess")],"revision":rules["revision"]});
            let rejected = app.request(Method::POST, "/v1/classify", &extra).await;
            assert_eq!(rejected.0, StatusCode::TOO_MANY_REQUESTS);
            assert_eq!(app.provider.model_calls.load(SeqCst), expected);
            assert_eq!(app.provider.cover_calls.load(SeqCst), expected);
            gate.wait().await;
        };
        let (results, ()) = tokio::join!(admitted, overflow);
        assert!(
            results
                .iter()
                .all(|(status, r)| *status == StatusCode::OK
                    && r["results"][0]["decision"] == "allow")
        );
        *app.provider.classification_gate.lock().unwrap() = None;
        assert_eq!(
            app.verdict("excess", &rules["revision"]).await["decision"],
            "allow"
        );
        assert_eq!(app.provider.model_calls.load(SeqCst), expected + 1);
    }
}

#[tokio::test]
async fn disabling_the_last_rule_immediately_unmasks_cards_while_an_old_batch_owns_the_slot() {
    let runtime = json!({
        "providerLimits":{"test-vision":1},"modelConcurrency":1,"coverConcurrency":1,
        "browserConcurrency":1,"batchSize":1
    });
    let app = Fixture::with_config(&[1], Some(runtime)).await;
    let state = app
        .save(json!([group("only", "唯一规则")]), &Value::Null)
        .await;
    let gate = Arc::new(Barrier::new(2));
    *app.provider.classification_gate.lock().unwrap() = Some(gate.clone());
    let body = json!({"cards":[card("old")],"revision":state["revision"]});
    let old = app.request(Method::POST, "/v1/classify", &body);
    let disable = async {
        tokio::time::timeout(
            Duration::from_secs(4),
            app.provider.model_entered.notified(),
        )
        .await
        .unwrap();
        let empty = app.save(json!([]), &state["revision"]).await;
        assert_eq!(
            app.verdict("new", &empty["revision"]).await["decision"],
            "allow"
        );
        assert_eq!(app.provider.cover_calls.load(SeqCst), 1);
        assert_eq!(app.provider.model_calls.load(SeqCst), 1);
        gate.wait().await;
    };
    let ((status, _), ()) = tokio::join!(old, disable);
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn editing_a_disabled_group_reapplies_settings_without_rebilling_unrelated_cards() {
    let app = Fixture::new(&[1]).await;
    let enabled = group("active", "启用条件");
    let mut paused = group("inactive", "未启用条件");
    paused["enabled"] = json!(false);
    let original = app.save(json!([enabled, paused]), &Value::Null).await;
    assert_eq!(
        app.verdict("cached", &original["revision"]).await["decision"],
        "block"
    );
    paused["exclude"] = json!(["停用组的新例外"]);
    let edited = app
        .save(json!([enabled, paused]), &original["revision"])
        .await;
    assert_ne!(original["revision"], edited["revision"]);
    assert_eq!(
        app.verdict("cached", &edited["revision"]).await["rule"],
        "启用条件"
    );
    assert_eq!(app.provider.model_calls.load(SeqCst), 1);
    let mut active = enabled;
    active["exclude"] = json!(["正在生效的例外"]);
    let changed = app.save(json!([active, paused]), &edited["revision"]).await;
    app.verdict("cached", &changed["revision"]).await;
    assert_eq!(app.provider.model_calls.load(SeqCst), 2);
}
