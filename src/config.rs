use crate::plugins::{LEGACY_SITE, SiteSchedule, valid_id};
use eyre::{Result, ensure, eyre};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fmt, fs,
    io::{ErrorKind, Write},
    path::Path,
};
use tempfile::NamedTempFile;

const DEFAULTS: &str = include_str!("../config/runtime.json");
fn default_model() -> String {
    "deepseek-flash".into()
}
fn default_endpoint() -> String {
    "https://api.deepseek.com".into()
}

// The Serialize representation remains the scheduling object used in /v1/status.
// Explicit disk and editor representations below choose which other fields to expose.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Config {
    #[serde(default = "default_model", skip_serializing)]
    pub model: String,
    #[serde(default = "default_endpoint", skip_serializing)]
    pub endpoint: String,
    #[serde(default, skip_serializing)]
    api_key: String,
    provider_limits: BTreeMap<String, usize>,
    pub model_concurrency: usize,
    #[serde(default)]
    pub site_scheduling: BTreeMap<String, SiteSchedule>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub not_interested_sites: BTreeSet<String>,
    pub batch_size: usize,
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.public().fmt(f)
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfigUpdate {
    pub model: Option<String>,
    #[serde(alias = "endpoint")]
    pub api_base: Option<String>,
    pub api_key: Option<String>,
    pub provider_limits: Option<BTreeMap<String, usize>>,
    pub model_concurrency: Option<usize>,
    pub cover_concurrency: Option<usize>,
    pub browser_concurrency: Option<usize>,
    pub batch_size: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskConfig<'a> {
    #[serde(flatten)]
    scheduling: &'a Config,
    model: &'a str,
    endpoint: &'a str,
    api_key: &'a str,
}

fn endpoint_url(base: &str) -> Result<Url> {
    let url = Url::parse(base).map_err(|_| eyre!("模型服务地址无效"))?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    ensure!(
        (url.scheme() == "https" || (local && url.scheme() == "http"))
            && base.len() <= 2048
            && url.host().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "模型服务地址仅支持 HTTPS 或本机 HTTP，地址中不能包含凭据、查询参数或片段"
    );
    Ok(url)
}

pub(crate) fn ensure_directory(dir: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    Ok(())
}

fn restrict_existing_file(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::metadata(path)?.permissions();
        if perms.mode() & 0o777 != 0o600 {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

impl Config {
    pub fn load(dir: &Path) -> Result<Self> {
        Self::load_with(dir, &|name| env::var(name).ok())
    }

    fn load_with(dir: &Path, read_env: &dyn Fn(&str) -> Option<String>) -> Result<Self> {
        ensure_directory(dir)?;
        let file = dir.join("runtime.json");
        let bytes = match fs::read(&file) {
            Ok(bytes) => {
                restrict_existing_file(&file)?;
                bytes
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {
                let initial = Self::default().with_environment(read_env)?;
                if initial.write_file(dir, false)? {
                    return Ok(initial);
                }
                // A concurrent first launch installed a complete file first.
                restrict_existing_file(&file)?;
                fs::read(&file)?
            }
            Err(e) => return Err(e.into()),
        };
        let mut object: Value = serde_json::from_slice(&bytes).map_err(|err| {
            eyre!(
                "runtime.json JSON 无效（行 {}，列 {}）",
                err.line(),
                err.column()
            )
        })?;
        let legacy = ["model", "endpoint", "apiKey"]
            .iter()
            .all(|field| object.get(field).is_none());
        let fields = object
            .as_object_mut()
            .ok_or_else(|| eyre!("runtime.json 配置格式无效"))?;
        let old_cover = fields.remove("coverConcurrency");
        let old_browser = fields.remove("browserConcurrency");
        let migrate_site = old_cover.is_some() || old_browser.is_some();
        if migrate_site {
            let defaults = SiteSchedule::default();
            let schedule: SiteSchedule = serde_json::from_value(json!({
                "coverConcurrency":old_cover.unwrap_or(json!(defaults.cover_concurrency)),
                "browserConcurrency":old_browser.unwrap_or(json!(defaults.browser_concurrency)),
            }))
            .map_err(|_| eyre!("旧版站点并发配置无效"))?;
            ensure!(schedule.valid(), "旧版站点并发配置超出范围");
            let sites = fields
                .entry("siteScheduling")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .ok_or_else(|| eyre!("站点配置格式无效"))?;
            sites.entry(LEGACY_SITE).or_insert(json!(schedule));
        }
        // Serde diagnostics may quote submitted data. Keep configuration errors free of values.
        let mut result: Self =
            serde_json::from_value(object).map_err(|_| eyre!("runtime.json 配置格式无效"))?;
        result.validate()?;
        let old_batch = result.batch_size != 1;
        result.batch_size = 1;
        if legacy {
            let migrated = result.with_environment(read_env)?;
            migrated.save(dir)?;
            Ok(migrated)
        } else {
            if old_batch || migrate_site {
                result.save(dir)?;
            }
            Ok(result)
        }
    }

    fn with_environment(mut self, read: &dyn Fn(&str) -> Option<String>) -> Result<Self> {
        let read = |name| {
            read(name)
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        };
        if let Some(model) = read("COGNITION_MODEL") {
            self.model = model;
        }
        if let Some(base) = read("COGNITION_API_BASE") {
            self.endpoint = base;
        }
        let official = endpoint_url(&self.endpoint)?.origin().ascii_serialization()
            == "https://api.deepseek.com";
        self.api_key = read("COGNITION_API_KEY")
            .or_else(|| {
                if official {
                    read("DEEPSEEK_API_KEY")
                } else {
                    None
                }
            })
            .unwrap_or_default();
        self.validate()?;
        Ok(self)
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    pub fn public(&self) -> Value {
        let mut info = json!(self);
        info["model"] = json!(self.model);
        info["apiBase"] = json!(self.endpoint);
        info["hasApiKey"] = json!(!self.api_key.is_empty());
        info
    }

    pub fn updated(&self, patch: ConfigUpdate) -> Result<Self> {
        let mut next = self.clone();
        if let Some(model) = patch.model {
            model.trim().clone_into(&mut next.model);
        }
        if let Some(base) = patch.api_base {
            let base = base.trim();
            let changed_origin =
                endpoint_url(base)?.origin() != endpoint_url(&self.endpoint)?.origin();
            ensure!(
                !changed_origin || self.api_key.is_empty() || patch.api_key.is_some(),
                "更换服务提供方时请重新输入该服务的 API Key，或明确清空密钥"
            );
            base.clone_into(&mut next.endpoint);
        }
        if let Some(key) = patch.api_key {
            key.trim().clone_into(&mut next.api_key);
        }
        if let Some(limits) = patch.provider_limits {
            next.provider_limits = limits;
        }
        if let Some(v) = patch.model_concurrency {
            next.model_concurrency = v;
        }
        if patch.cover_concurrency.is_some() || patch.browser_concurrency.is_some() {
            let site = next.site_scheduling.entry(LEGACY_SITE.into()).or_default();
            if let Some(v) = patch.cover_concurrency {
                site.cover_concurrency = v;
            }
            if let Some(v) = patch.browser_concurrency {
                site.browser_concurrency = v;
            }
        }
        if let Some(v) = patch.batch_size {
            ensure!((1..=8).contains(&v), "旧配置的批大小超出范围");
        }
        next.validate()?;
        Ok(next)
    }

    fn validate(&self) -> Result<()> {
        endpoint_url(&self.endpoint)?;
        ensure!(
            (1..=160).contains(&self.model.len())
                && self
                    .model
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_./:-".contains(&b)),
            "模型名称无效"
        );
        ensure!(
            self.api_key.len() <= 4096 && self.api_key.bytes().all(|b| b.is_ascii_graphic()),
            "API Key 格式无效"
        );
        ensure!(
            (1..=2500).contains(&self.model_concurrency)
                && self
                    .site_scheduling
                    .iter()
                    .all(|(id, s)| valid_id(id) && s.valid())
                && (1..=8).contains(&self.batch_size)
                && self
                    .provider_limits
                    .values()
                    .all(|n| (1..=2500).contains(n)),
            "runtime.json 并发或批大小超出范围"
        );
        Ok(())
    }

    pub fn save(&self, dir: &Path) -> Result<()> {
        self.validate()?;
        ensure_directory(dir)?;
        self.write_file(dir, true)?;
        Ok(())
    }

    fn write_file(&self, dir: &Path, replace: bool) -> Result<bool> {
        let mut tmp = NamedTempFile::new_in(dir)?;
        let disk = DiskConfig {
            scheduling: self,
            model: &self.model,
            endpoint: &self.endpoint,
            api_key: &self.api_key,
        };
        serde_json::to_writer_pretty(&mut tmp, &disk)?;
        tmp.write_all(b"\n")?;
        tmp.as_file().sync_all()?;
        let file = dir.join("runtime.json");
        if replace {
            tmp.persist(file)?;
        } else if let Err(e) = tmp.persist_noclobber(file) {
            if e.error.kind() == ErrorKind::AlreadyExists {
                return Ok(false);
            }
            return Err(e.into());
        }
        Ok(true)
    }
    pub fn schedule(&self, site: &crate::plugins::Site) -> SiteSchedule {
        self.site_scheduling
            .get(&site.id)
            .copied()
            .unwrap_or(site.scheduling)
    }
    pub fn model_limit(&self, model: &str) -> usize {
        self.model_concurrency.min(
            *self
                .provider_limits
                .get(model)
                .unwrap_or(&self.model_concurrency),
        )
    }
}
impl Default for Config {
    fn default() -> Self {
        serde_json::from_str(DEFAULTS).expect("valid bundled scheduling config")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn first_load_installs_defaults_then_uses_the_saved_provider_and_global_limits() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("runtime.json");
        let first = Config::load_with(dir.path(), &|_| None)?;
        let saved: Value = serde_json::from_slice(&fs::read(&path)?)?;
        assert_eq!(saved["model"], first.model);
        assert_eq!(saved["endpoint"], first.endpoint);
        assert_eq!(saved["apiKey"], "");
        assert_eq!(saved["providerLimits"]["deepseek-flash"], 2500);
        let mut configured = json!({
            "providerLimits":{"deepseek-flash":2500,"other":3},
            "modelConcurrency":2500,"coverConcurrency":256,"browserConcurrency":32,"batchSize":8
        });
        fs::write(&path, serde_json::to_vec(&configured)?)?;
        let next = Config::load_with(dir.path(), &|_| None)?;
        assert_eq!(next.model_limit("deepseek-flash"), 2500);
        assert_eq!(next.model_limit("other"), 3);
        assert_eq!(next.model_limit("unlisted"), 2500);
        configured
            .as_object_mut()
            .unwrap()
            .remove("coverConcurrency");
        configured
            .as_object_mut()
            .unwrap()
            .remove("browserConcurrency");
        configured["siteScheduling"] =
            json!({"bilibili":{"coverConcurrency":256,"browserConcurrency":32}});
        configured["batchSize"] = json!(1);
        assert_eq!(serde_json::to_value(&next)?, configured);
        let migrated: Value = serde_json::from_slice(&fs::read(&path)?)?;
        assert_eq!(migrated["batchSize"], 1);
        Ok(())
    }

    #[test]
    fn concurrent_first_launches_read_the_same_complete_initial_file() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let start = std::sync::Barrier::new(4);
        let values = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..4)
                .map(|i| {
                    let start = &start;
                    let path = dir.path();
                    scope.spawn(move || {
                        start.wait();
                        Config::load_with(path, &|name| {
                            (name == "COGNITION_API_KEY").then(|| format!("test-launch-{i}"))
                        })
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect::<Result<Vec<_>>>()
        })?;
        let persisted = Config::load_with(dir.path(), &|_| panic!("file should already exist"))?;
        assert!(
            values
                .iter()
                .all(|cfg| cfg.api_key() == persisted.api_key())
        );
        Ok(())
    }

    #[test]
    fn invalid_concurrency_and_batch_limits_fail_without_overwriting_the_users_file() -> Result<()>
    {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("runtime.json");
        let defaults = serde_json::to_value(Config::default())?;
        for (field, invalid) in [
            ("modelConcurrency", json!(0)),
            ("modelConcurrency", json!(2501)),
            ("coverConcurrency", json!(0)),
            ("coverConcurrency", json!(257)),
            ("browserConcurrency", json!(0)),
            ("browserConcurrency", json!(33)),
            ("batchSize", json!(0)),
            ("batchSize", json!(9)),
            ("providerLimits", json!({"deepseek-flash":2501})),
            ("providerLimits", json!({"custom":0})),
            ("unknownKey", json!(2)),
        ] {
            let mut edited = defaults.clone();
            edited[field] = invalid;
            let contents = serde_json::to_vec(&edited)?;
            fs::write(&path, &contents)?;
            assert!(
                Config::load_with(dir.path(), &|_| None).is_err(),
                "accepted {edited}"
            );
            assert_eq!(fs::read(&path)?, contents);
        }
        Ok(())
    }

    #[test]
    fn keys_round_trip_only_through_disk_and_omitted_updates_preserve_them() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let original = Config::load_with(dir.path(), &|_| None)?;
        let mock_key = "test-only-not-a-real-credential";
        let patch = serde_json::from_value(json!({
            "model":"local/vision","apiBase":"http://127.0.0.1:9876/v1","apiKey":mock_key,"batchSize":2
        }))?;
        let keyed = original.updated(patch)?;
        keyed.save(dir.path())?;
        let restored =
            Config::load_with(dir.path(), &|_| panic!("must not re-import environment"))?;
        assert_eq!(restored.api_key(), mock_key);
        assert_eq!(restored.public()["hasApiKey"], true);
        for representation in [
            format!("{restored:?}"),
            restored.public().to_string(),
            serde_json::to_string(&restored)?,
        ] {
            assert!(!representation.contains(mock_key));
        }
        assert!(restored.public().get("apiKey").is_none());
        let edit = restored.updated(serde_json::from_value(
            json!({"apiBase":"http://127.0.0.1:9876/other","browserConcurrency":2}),
        )?)?;
        assert_eq!(edit.api_key(), mock_key);
        assert!(
            restored
                .updated(serde_json::from_value(
                    json!({"apiBase":"https://other.invalid"})
                )?)
                .is_err()
        );
        let clear = restored.updated(serde_json::from_value(
            json!({"apiBase":"https://other.invalid","apiKey":""}),
        )?)?;
        clear.save(dir.path())?;
        let empty =
            Config::load_with(dir.path(), &|_| panic!("explicit key removal must persist"))?;
        assert_eq!(empty.api_key(), "");
        assert_eq!(empty.public()["hasApiKey"], false);
        Ok(())
    }

    #[test]
    fn migration_imports_only_credentials_for_the_selected_provider_once() -> Result<()> {
        let official = tempfile::tempdir()?;
        let cfg = Config::load_with(official.path(), &|name| {
            (name == "DEEPSEEK_API_KEY").then(|| "test-official-only".into())
        })?;
        assert_eq!(cfg.api_key(), "test-official-only");
        let other = tempfile::tempdir()?;
        // Simulate the earlier scheduling-only file.
        let path = other.path().join("runtime.json");
        fs::write(&path, serde_json::to_vec(&Config::default())?)?;
        let cfg = Config::load_with(other.path(), &|name| match name {
            "COGNITION_API_BASE" => Some("https://other.invalid/v1".into()),
            "COGNITION_MODEL" => Some("other/vision".into()),
            "COGNITION_API_KEY" => Some("test-other-only".into()),
            "DEEPSEEK_API_KEY" => panic!("must not read another provider's key"),
            _ => None,
        })?;
        assert_eq!(cfg.model, "other/vision");
        assert_eq!(cfg.api_key(), "test-other-only");
        let bytes = fs::read(path)?;
        let stored: Value = serde_json::from_slice(&bytes)?;
        assert_eq!(stored["endpoint"], "https://other.invalid/v1");
        assert_eq!(stored["apiKey"], "test-other-only");
        assert_eq!(
            Config::load_with(other.path(), &|_| panic!("migration ran twice"))?.model,
            cfg.model
        );
        Ok(())
    }

    #[test]
    fn invalid_provider_changes_keep_previous_disk_and_hide_values_in_errors() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let current = Config::load_with(dir.path(), &|_| None)?;
        for patch in [
            json!({"apiBase":"http://remote.invalid/"}),
            json!({"apiBase":"https://u:test-secret@example.invalid"}),
            json!({"apiBase":"https://example.invalid/?key=test-secret"}),
            json!({"apiKey":"A\ntest-secret"}),
            json!({"model":"bad model\ntest-secret"}),
        ] {
            let err = current.updated(serde_json::from_value(patch)?).unwrap_err();
            assert!(!format!("{err:?}").contains("test-secret"));
        }
        let loaded = Config::load_with(dir.path(), &|_| None)?;
        assert_eq!(loaded.public(), current.public());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn old_and_new_configuration_files_are_private() -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir()?;
        let cfg = Config::load_with(dir.path(), &|_| None)?;
        let path = dir.path().join("runtime.json");
        assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644))?;
        Config::load_with(dir.path(), &|_| None)?;
        assert_eq!(fs::metadata(&path)?.permissions().mode() & 0o777, 0o600);
        cfg.save(dir.path())?;
        assert_eq!(fs::metadata(path)?.permissions().mode() & 0o777, 0o600);
        Ok(())
    }
}
