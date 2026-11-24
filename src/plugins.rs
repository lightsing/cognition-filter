//! Load site manifests and script snapshots from the installation's plugins directory.
use axum::body::Bytes;
use eyre::{Result, WrapErr, ensure, eyre};
use libloading::Library;
use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock, RwLockReadGuard},
};
use tempfile::NamedTempFile;

pub(crate) const LEGACY_SITE: &str = "bilibili";
const CLIENT: &str = include_str!("../sdk/client.js");
const CLIENT_MARKER: &str = "/* @cognition-client-v1 */";
type ResourceFn = unsafe extern "C" fn(u32, *mut usize) -> *const u8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CoverPolicy {
    hosts: Vec<String>,
    path_pattern: String,
    #[serde(default)]
    strip_from: Option<char>,
    #[serde(default)]
    suffix: String,
    referer: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SiteSchedule {
    pub cover_concurrency: usize,
    pub browser_concurrency: usize,
}
impl Default for SiteSchedule {
    fn default() -> Self {
        Self {
            cover_concurrency: 48,
            browser_concurrency: 8,
        }
    }
}
impl SiteSchedule {
    pub fn valid(self) -> bool {
        (1..=256).contains(&self.cover_concurrency) && (1..=32).contains(&self.browser_concurrency)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    text_post_limit: Option<usize>,
    #[serde(default)]
    supports_not_interested: bool,
    id: String,
    name: String,
    version: String,
    cover: Option<CoverPolicy>,
    #[serde(default)]
    scheduling: SiteSchedule,
    script_version: Option<String>,
    page_policy: Option<serde_json::Map<String, serde_json::Value>>,
}

pub(crate) struct Site {
    pub text_post_limit: Option<usize>,
    pub supports_not_interested: bool,
    pub id: String,
    pub name: String,
    pub version: String,
    pub script: Bytes,
    pub script_version: String,
    pub page_policy: Option<serde_json::Map<String, serde_json::Value>>,
    pub scheduling: SiteSchedule,
    pub file: String,
    cover: Option<(CoverPolicy, Regex)>,
}

pub(crate) fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

impl Site {
    fn parse(manifest: &str, script: &str) -> Result<Self> {
        let m: Manifest = serde_json::from_str(manifest)?;
        ensure!(valid_id(&m.id), "站点 ID 无效");
        ensure!(
            !m.name.trim().is_empty()
                && m.name.len() <= 200
                && !m.version.is_empty()
                && m.version.len() < 20
                && m.version.bytes().all(|b| b.is_ascii_digit() || b == b'.'),
            "站点名称或版本无效"
        );
        ensure!(
            script.starts_with("// ==UserScript==")
                && script.lines().any(|l| l.trim_end() == "// ==/UserScript=="),
            "缺少油猴脚本头"
        );
        let cover = if let Some(policy) = m.cover {
            ensure!(
                !policy.hosts.is_empty()
                    && policy.hosts.iter().all(|h| h.len() <= 253
                        && h.contains('.')
                        && h.bytes().all(|c| c.is_ascii_lowercase()
                            || c.is_ascii_digit()
                            || matches!(c, b'.' | b'-'))),
                "封面源必须使用明确的主机名"
            );
            ensure!(
                policy
                    .suffix
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"@_.-".contains(&c)),
                "无效的封面后缀"
            );
            if let Some(referer) = &policy.referer {
                let origin = Url::parse(referer)?;
                ensure!(
                    origin.scheme() == "https"
                        && origin.host().is_some()
                        && origin.username().is_empty()
                        && origin.password().is_none(),
                    "无效的封面 Referer"
                );
            }
            let regex = Regex::new(&format!(r"\A(?:{})\z", policy.path_pattern))?;
            Some((policy, regex))
        } else {
            None
        };
        ensure!(m.scheduling.valid(), "站点并发配置超出范围");
        ensure!(
            m.text_post_limit.is_none_or(|n| (1..=8192).contains(&n)),
            "帖子正文长度上限无效"
        );
        let script_version = m.script_version.as_deref().unwrap_or(&m.version);
        ensure!(
            !script_version.is_empty()
                && script_version.len() < 20
                && script_version
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b == b'.'),
            "脚本版本无效"
        );
        let metadata = script
            .split_once("// ==/UserScript==")
            .expect("validated header")
            .0;
        ensure!(
            metadata.lines().any(|line| {
                let mut words = line.split_whitespace();
                words.next() == Some("//")
                    && words.next() == Some("@version")
                    && words.next() == Some(script_version)
            }),
            "脚本 @version 与清单声明不符"
        );
        let client = CLIENT
            .replace("__CF_SITE_ID__", &m.id)
            .replace("__CF_SITE_VERSION__", script_version);
        let policy_marker = "/* @cognition-page-policy-v1 */ null";
        if script.contains(policy_marker) {
            ensure!(
                m.page_policy.as_ref().is_some_and(|v| !v.is_empty()),
                "缺少站点页面策略"
            );
        }
        let script = script
            .replace(CLIENT_MARKER, &client)
            .replace(policy_marker, &serde_json::to_string(&m.page_policy)?);
        Ok(Self {
            script_version: script_version.to_owned(),
            id: m.id,
            name: m.name,
            version: m.version,
            script: script.into(),
            page_policy: m.page_policy,
            file: String::new(),
            scheduling: m.scheduling,
            text_post_limit: m.text_post_limit,
            supports_not_interested: m.supports_not_interested,
            cover,
        })
    }

    pub fn thumbnail(&self, input: &str) -> Result<(String, Option<&str>)> {
        let (policy, pattern) = self
            .cover
            .as_ref()
            .ok_or_else(|| eyre!("站点仅接受页面封面"))?;
        ensure!(input.len() <= 4096, "封面地址过长");
        let normalized = if input.starts_with("//") {
            format!("https:{input}")
        } else {
            input.to_owned()
        };
        let url = Url::parse(&normalized)?;
        let host = url.host_str().unwrap_or_default();
        ensure!(
            matches!(url.scheme(), "http" | "https")
                && policy.hosts.iter().any(|h| h == host)
                && url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none(),
            "站点不支持此封面地址"
        );
        let path = policy
            .strip_from
            .and_then(|c| url.path().split_once(c))
            .map_or(url.path(), |(p, _)| p);
        ensure!(pattern.is_match(path), "站点不支持此封面路径");
        Ok((
            format!("https://{host}{path}{}", policy.suffix),
            policy.referer.as_deref(),
        ))
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct DisabledSite {
    #[serde(default, rename = "supportsNotInterested")]
    pub supports_not_interested: bool,
    #[serde(default, rename = "scriptVersion")]
    pub script_version: Option<String>,
    #[serde(default)]
    pub scheduling: SiteSchedule,
    pub name: String,
    pub version: String,
    pub file: String,
}

#[derive(Clone, Default)]
pub(crate) struct Sites {
    pub entries: BTreeMap<String, Arc<Site>>,
    pub disabled: BTreeMap<String, DisabledSite>,
    pub errors: Vec<String>,
    directory: PathBuf,
    preferences: PathBuf,
}

fn library_file(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.eq_ignore_ascii_case(env::consts::DLL_EXTENSION))
}

impl Sites {
    pub fn discover(dir: &Path, data: &Path) -> Result<Self> {
        let preferences = data.join("disabled-plugins.json");
        let disabled: BTreeMap<String, DisabledSite> = match fs::read(&preferences) {
            Ok(bytes) => serde_json::from_slice(&bytes).wrap_err("禁用插件列表无效")?,
            Err(e) if e.kind() == ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.into()),
        };
        for (id, saved) in &disabled {
            let path = Path::new(&saved.file);
            ensure!(
                valid_id(id)
                    && path.file_name() == Some(path.as_os_str())
                    && library_file(path)
                    && !saved.file.contains(['/', '\\', ':']),
                "禁用插件记录无效"
            );
        }
        let mut sites = Self {
            directory: dir.to_owned(),
            preferences,
            disabled,
            ..Self::default()
        };
        sites.scan()?;
        Ok(sites)
    }

    fn scan(&mut self) -> Result<()> {
        self.errors.clear();
        let listing = match fs::read_dir(&self.directory) {
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
            entries => entries?,
        };
        let mut paths = Vec::new();
        for entry in listing {
            let path = entry?.path();
            if library_file(&path) && path.is_file() {
                paths.push(path);
            }
        }
        paths.sort();
        for path in paths {
            let file = path.file_name().unwrap_or_default().to_string_lossy();
            if self.entries.values().any(|s| s.file == file)
                || self.disabled.values().any(|s| s.file == file)
            {
                continue;
            }
            let result = load_library(&path).and_then(|site| self.register(site));
            if let Err(error) = result {
                self.errors.push(format!("{file} · {error}"));
                tracing::warn!(%file, %error, "站点插件载入失败");
            }
        }
        Ok(())
    }

    fn save_disabled(&self) -> Result<()> {
        let mut tmp = NamedTempFile::new_in(
            self.preferences
                .parent()
                .ok_or_else(|| eyre!("未设置插件配置目录"))?,
        )?;
        serde_json::to_writer_pretty(&mut tmp, &self.disabled)?;
        tmp.as_file().sync_all()?;
        tmp.persist(&self.preferences)?;
        Ok(())
    }

    fn replace_site(&mut self, id: &str, action: Action) -> Result<()> {
        let old = self.entries.get(id);
        let saved = self.disabled.get(id);
        let file = old
            .map(|s| &s.file)
            .or_else(|| saved.map(|s| &s.file))
            .ok_or_else(|| eyre!("未知站点插件"))?;
        match action {
            Action::Enable(true) if old.is_some() => return Ok(()),
            Action::Enable(false) if saved.is_some() => return Ok(()),
            Action::Enable(false) => {
                let old = old.expect("known enabled site");
                self.disabled
                    .insert(id.to_owned(), DisabledSite::from(old.as_ref()));
                self.entries.remove(id);
            }
            Action::Reload | Action::Enable(true) => {
                let next = load_library(&self.directory.join(file))?;
                ensure!(next.id == id, "DLL 的站点 ID 已改变");
                if saved.is_some() && matches!(action, Action::Reload) {
                    self.disabled
                        .insert(id.to_owned(), DisabledSite::from(&next));
                } else {
                    self.entries.insert(id.to_owned(), Arc::new(next));
                    if self.disabled.remove(id).is_none() {
                        return Ok(());
                    }
                }
            }
        }
        self.save_disabled()
    }

    fn register(&mut self, site: Site) -> Result<()> {
        ensure!(
            !self.entries.contains_key(&site.id) && !self.disabled.contains_key(&site.id),
            "重复的站点 ID {}",
            site.id
        );
        self.entries.insert(site.id.clone(), Arc::new(site));
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn fixture() -> Self {
        Self::fixture_for(
            include_str!("../plugins/bilibili/site.json"),
            include_str!("../plugins/bilibili/bilibili.user.js"),
        )
    }

    #[cfg(test)]
    pub(crate) fn fixture_for(manifest: &str, script: &str) -> Self {
        let mut sites = Self::default();
        sites
            .register(Site::parse(manifest, script).unwrap())
            .unwrap();
        sites
    }
}

impl From<&Site> for DisabledSite {
    fn from(site: &Site) -> Self {
        Self {
            script_version: Some(site.script_version.clone()),
            scheduling: site.scheduling,
            supports_not_interested: site.supports_not_interested,
            name: site.name.clone(),
            version: site.version.clone(),
            file: site.file.clone(),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Action {
    Enable(bool),
    Reload,
}

pub(crate) struct PluginManager {
    current: RwLock<Sites>,
    changes: Mutex<()>,
}

impl PluginManager {
    pub fn new(sites: Sites) -> Self {
        Self {
            current: RwLock::new(sites),
            changes: Mutex::new(()),
        }
    }
    pub fn read(&self) -> RwLockReadGuard<'_, Sites> {
        self.current
            .read()
            .unwrap_or_else(|poison| poison.into_inner())
    }
    // Management runs on the blocking pool. Readers use the last complete snapshot
    // while the replacement DLL is opened and preferences are persisted.
    pub fn change(&self, site: Option<(&str, Action)>) -> Result<()> {
        let _edit = self
            .changes
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut next = self.read().clone();
        if let Some((id, action)) = site {
            next.replace_site(id, action)?
        } else {
            next.scan()?
        }
        *self
            .current
            .write()
            .unwrap_or_else(|poison| poison.into_inner()) = next;
        Ok(())
    }
}

fn load_library(path: &Path) -> Result<Site> {
    let absolute = path.canonicalize()?;
    // SAFETY: native plugins are installed locally by the user. Their ABI contract requires
    // statically readable resource bytes until unload. No Rust types or allocations cross it.
    let library: Library = unsafe {
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::LibraryLoader::{
                LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32,
            };
            libloading::os::windows::Library::load_with_flags(
                &absolute,
                LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32,
            )?
            .into()
        }
        #[cfg(not(windows))]
        {
            Library::new(&absolute)?
        }
    };
    // SAFETY: the versioned C symbol has the signature declared in sdk/cf_site.h.
    let entry = unsafe { library.get::<ResourceFn>(b"cf_site_resource_v1\0") }
        .wrap_err("缺少 v1 插件入口")?;
    let read = |kind, limit| -> Result<&str> {
        let mut len = 0;
        // SAFETY: len is writable for this call; the trusted DLL owns the returned resource.
        let ptr = unsafe { entry(kind, &mut len) };
        ensure!(
            !ptr.is_null() && (1..=limit).contains(&len),
            "缺少资源或长度无效"
        );
        // SAFETY: memory remains live while library is held. Site::parse copies retained data.
        Ok(std::str::from_utf8(unsafe {
            std::slice::from_raw_parts(ptr, len)
        })?)
    };
    let mut site = Site::parse(read(0, 65536)?, read(1, 2 * 1024 * 1024)?)?;
    path.file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| eyre!("无效的 DLL 文件名"))?
        .clone_into(&mut site.file);
    Ok(site)
}
