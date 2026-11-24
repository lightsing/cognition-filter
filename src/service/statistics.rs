use super::{App, State};
use crate::model::Usage;
use axum::Json;
use eyre::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::NamedTempFile;
use tokio::sync::oneshot;

#[derive(Clone, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Stats {
    pub batches: u64,
    pub cards: u64,
    pub cache_hits: u64,
    pub model_calls: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub prefix_hit_tokens: u64,
    pub allow: u64,
    pub block: u64,
    pub pending: u64,
    pub reflection_calls: u64,
    pub warmup_calls: u64,
    pub warmup_failures: u64,
    pub warmup_input_tokens: u64,
    pub warmup_output_tokens: u64,
    pub warmup_hit_tokens: u64,
    pub reported: u64,
    pub picked: u64,
    pub rule_hits: BTreeMap<String, u64>,
}

impl Stats {
    pub fn add(&mut self, usage: &Usage) {
        self.input_tokens += usage.input;
        self.output_tokens += usage.output;
        self.prefix_hit_tokens += usage.cached;
    }

    fn combined(&self, other: &Self) -> Self {
        let mut rule_hits = self.rule_hits.clone();
        for (id, count) in &other.rule_hits {
            let n = rule_hits.entry(id.clone()).or_default();
            *n = n.saturating_add(*count);
        }
        Self {
            batches: self.batches.saturating_add(other.batches),
            cards: self.cards.saturating_add(other.cards),
            cache_hits: self.cache_hits.saturating_add(other.cache_hits),
            model_calls: self.model_calls.saturating_add(other.model_calls),
            input_tokens: self.input_tokens.saturating_add(other.input_tokens),
            output_tokens: self.output_tokens.saturating_add(other.output_tokens),
            prefix_hit_tokens: self
                .prefix_hit_tokens
                .saturating_add(other.prefix_hit_tokens),
            allow: self.allow.saturating_add(other.allow),
            block: self.block.saturating_add(other.block),
            pending: self.pending.saturating_add(other.pending),
            reflection_calls: self.reflection_calls.saturating_add(other.reflection_calls),
            warmup_calls: self.warmup_calls.saturating_add(other.warmup_calls),
            warmup_failures: self.warmup_failures.saturating_add(other.warmup_failures),
            warmup_input_tokens: self
                .warmup_input_tokens
                .saturating_add(other.warmup_input_tokens),
            warmup_output_tokens: self
                .warmup_output_tokens
                .saturating_add(other.warmup_output_tokens),
            warmup_hit_tokens: self
                .warmup_hit_tokens
                .saturating_add(other.warmup_hit_tokens),
            reported: self.reported.saturating_add(other.reported),
            picked: self.picked.saturating_add(other.picked),
            rule_hits,
        }
    }
}

#[derive(Clone, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Ledger {
    unattributed: Stats,
    sites: BTreeMap<String, Stats>,
}

impl Ledger {
    pub fn site(&mut self, id: &str) -> &mut Stats {
        self.sites.entry(id.to_owned()).or_default()
    }

    pub fn global(&self) -> Stats {
        self.sites
            .values()
            .fold(self.unattributed.clone(), |sum, site| sum.combined(site))
    }

    fn combined(&self, session: &Self) -> Self {
        let mut total = self.clone();
        for (id, counters) in &session.sites {
            let site = total.site(id);
            *site = site.combined(counters);
        }
        total.unattributed = total.unattributed.combined(&session.unattributed);
        total
    }
}

pub(super) fn load(dir: &Path) -> Result<Ledger> {
    let bytes = match fs::read(dir.join("statistics.json")) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Ledger::default()),
        Err(e) => return Err(e.into()),
    };
    let mut snapshot: Value = serde_json::from_slice(&bytes)?;
    match snapshot["version"].as_u64() {
        Some(1) => Ok(Ledger {
            unattributed: serde_json::from_value(snapshot["totals"].take())?,
            ..Ledger::default()
        }),
        Some(2) => Ok(serde_json::from_value(snapshot)?),
        _ => bail!("统计文件版本不受支持"),
    }
}

fn save(dir: &Path, ledger: Ledger) -> Result<()> {
    #[derive(Serialize)]
    struct Snapshot {
        version: u8,
        #[serde(flatten)]
        ledger: Ledger,
    }
    let tmp = NamedTempFile::new_in(dir)?;
    serde_json::to_writer(tmp.as_file(), &Snapshot { version: 2, ledger })?;
    tmp.as_file().sync_all()?;
    tmp.persist(dir.join("statistics.json"))?;
    Ok(())
}

pub(super) async fn get(State(app): State<App>) -> Json<Value> {
    let site_names: BTreeMap<_, _> = {
        let sites = app.sites.read();
        sites
            .entries
            .iter()
            .map(|(id, s)| (id.clone(), s.name.clone()))
            .chain(
                sites
                    .disabled
                    .iter()
                    .map(|(id, s)| (id.clone(), s.name.clone())),
            )
            .collect()
    };
    let rt = app.lock();
    let total = app.history.as_ref().map(|base| base.combined(&rt.stats));
    let names: BTreeMap<_, _> = rt
        .store
        .settings
        .groups
        .iter()
        .map(|g| (&g.id, &g.name))
        .collect();
    Json(json!({
        "session": rt.stats.global(), "total": total.as_ref().map(Ledger::global),
        "bySite": {"session": rt.stats.sites, "total": total.as_ref().map(|s| &s.sites)},
        "unattributed": total.as_ref().filter(|s| s.unattributed != Stats::default()).map(|s| &s.unattributed),
        "siteNames": site_names,
        "ruleNames": names, "saveFailed": rt.stats_save_failed,
    }))
}

pub(crate) struct Recorder {
    app: App,
    directory: PathBuf,
    last_saved: Ledger,
}
impl Recorder {
    pub(super) fn new(app: App) -> Self {
        let directory = app.lock().store.directory().to_owned();
        Self {
            app,
            directory,
            last_saved: Ledger::default(),
        }
    }

    async fn flush(&mut self) -> Result<()> {
        let Some(base) = &self.app.history else {
            return Ok(());
        };
        let session = self.app.lock().stats.clone();
        if session == self.last_saved {
            return Ok(());
        }
        let totals = base.combined(&session);
        let dir = self.directory.clone();
        tokio::task::spawn_blocking(move || save(&dir, totals)).await??;
        self.last_saved = session;
        Ok(())
    }

    pub(crate) async fn run(mut self, mut stop: oneshot::Receiver<()>) -> Result<()> {
        loop {
            let stopping = tokio::select! {
                _ = &mut stop => true,
                () = tokio::time::sleep(Duration::from_secs(5)) => false,
            };
            let result = self.flush().await;
            self.app.lock().stats_save_failed = result.is_err();
            if stopping {
                return result;
            }
            if let Err(error) = result {
                tracing::warn!(%error, "统计保存失败，将重试");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::Config,
        model::{Model, prompt_version},
        rules::Store,
    };

    fn reopen(dir: &Path) -> Result<Recorder> {
        let config = Config::default();
        let model = Model::from_config(&config)?;
        let store = Store::load(dir, &model.name, &model.endpoint, prompt_version())?;
        Ok(super::super::router_with_config(
            model,
            store,
            config,
            17321,
            crate::plugins::Sites::fixture(),
        )
        .1)
    }

    #[tokio::test]
    async fn checkpoint_restart_and_shutdown_count_each_session_once() -> Result<()> {
        let dir = tempfile::tempdir()?;
        fs::write(
            dir.path().join("statistics.json"),
            br#"{"version":1,"totals":{"cards":9,"warmupCalls":2}}"#,
        )?;
        let mut writer = reopen(dir.path())?;
        writer.app.lock().stats.site("bilibili").block = 3;
        writer
            .app
            .lock()
            .stats
            .site("bilibili")
            .rule_hits
            .insert("topic".into(), 3);
        writer.flush().await?;
        writer.flush().await?;
        writer.app.lock().stats.site("bilibili").allow = 2;
        let (tx, rx) = oneshot::channel();
        drop(tx);
        writer.run(rx).await?;
        let mut next = reopen(dir.path())?;
        next.app.lock().stats.site("bilibili").block = 1;
        next.app
            .lock()
            .stats
            .site("bilibili")
            .rule_hits
            .insert("topic".into(), 1);
        let Json(view) = get(State(next.app.clone())).await;
        assert_eq!(view["total"]["block"], 4);
        assert_eq!(view["session"]["block"], 1);
        assert_eq!(view["total"]["allow"], 2);
        assert_eq!(view["total"]["ruleHits"]["topic"], 4);
        assert_eq!(view["unattributed"]["cards"], 9);
        assert_eq!(view["total"]["warmupCalls"], 2);
        assert_eq!(view["bySite"]["total"]["bilibili"]["cards"], 0);
        assert_eq!(view["bySite"]["total"]["bilibili"]["block"], 4);
        assert_eq!(view["bySite"]["session"]["bilibili"]["block"], 1);
        next.flush().await?;
        assert_eq!(load(dir.path())?.global().block, 4);
        Ok(())
    }

    #[tokio::test]
    async fn unreadable_history_preserves_file_and_session_view() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("statistics.json");
        fs::write(&path, b"invalid")?;
        let mut writer = reopen(dir.path())?;
        writer.app.lock().stats.site("bilibili").allow = 1;
        writer.flush().await?;
        let Json(view) = get(State(writer.app.clone())).await;
        assert!(view["total"].is_null());
        assert_eq!(view["session"]["allow"], 1);
        assert_eq!(fs::read(path)?, b"invalid");
        Ok(())
    }
}
