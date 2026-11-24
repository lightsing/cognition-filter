use std::{
    collections::HashSet,
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};

use eyre::{Result, WrapErr, ensure, eyre};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Card {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default, rename = "pageCover", skip_serializing_if = "Option::is_none")]
    pub page_cover: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub(crate) struct Group {
    pub id: String,
    #[serde(default)]
    pub site: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    #[serde(
        default,
        rename = "disabledInclude",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub disabled_include: Vec<String>,
    #[serde(
        default,
        rename = "disabledExclude",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub disabled_exclude: Vec<String>,
}

impl Group {
    pub fn applies_to(&self, site: &str) -> bool {
        self.site.as_deref().is_none_or(|id| id == site)
    }
    pub fn active(&self) -> Option<Self> {
        if !self.enabled {
            return None;
        }
        let mut group = self.clone();
        group.include.retain(|p| !self.disabled_include.contains(p));
        group.exclude.retain(|p| !self.disabled_exclude.contains(p));
        group.disabled_include.clear();
        group.disabled_exclude.clear();
        (!group.include.is_empty()).then_some(group)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Example {
    pub card_key: String,
    pub group_id: String,
    pub point: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Settings {
    pub groups: Vec<Group>,
    pub rules: Vec<String>,
    pub revision: String,
}

pub(crate) fn digest(value: &impl Serialize) -> String {
    let bytes = serde_json::to_vec(value).expect("application data must be JSON serializable");
    hex::encode(Sha256::digest(bytes))
}

pub(crate) fn validate_cards(cards: &[Card], text_limit: usize) -> Result<()> {
    ensure!((1..=8).contains(&cards.len()), "每批需要 1 至 8 张卡片");
    let mut ids = HashSet::new();
    for c in cards {
        ensure!(
            !c.id.is_empty()
                && c.id.encode_utf16().count() <= 128
                && ids.insert(&c.id)
                && (!c.title.trim().is_empty()
                    || !c.cover.trim().is_empty()
                    || c.page_cover.is_some())
                && c.title.encode_utf16().count() <= text_limit
                && c.author.encode_utf16().count() <= 128
                && c.cover.encode_utf16().count() <= 2048
                && c.page_cover.as_ref().is_none_or(|s| s.len() <= 96 * 1024),
            "卡片字段无效或 ID 重复"
        );
    }
    Ok(())
}

fn text_fits(value: &str, limit: usize) -> bool {
    let value = value.trim();
    !value.is_empty() && value.chars().count() <= limit
}

pub(crate) fn validate_groups(groups: &[Group]) -> Result<()> {
    ensure!(groups.len() <= 24, "最多可设置 24 组规则");
    let mut ids = HashSet::new();
    for g in groups {
        ensure!(
            g.site.as_deref().is_none_or(crate::plugins::valid_id),
            "规则的站点 ID 无效"
        );
        ensure!(
            (1..=80).contains(&g.id.len())
                && g.id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                && ids.insert(&g.id),
            "规则组 ID 无效或重复"
        );
        ensure!(text_fits(&g.name, 60), "名称为空或过长");
        ensure!(
            (1..=8).contains(&g.include.len()) && g.exclude.len() <= 8,
            "每组需要 1 至 8 条命中要点，最多 8 条保留例外"
        );
        for (points, off) in [
            (&g.include, &g.disabled_include),
            (&g.exclude, &g.disabled_exclude),
        ] {
            ensure!(
                off.len() <= points.len() && off.iter().all(|p| points.contains(p)),
                "禁用要点必须属于当前规则"
            );
        }
        let limit = if g.id.starts_with("legacy-") {
            280
        } else {
            160
        };
        ensure!(
            g.include
                .iter()
                .chain(&g.exclude)
                .all(|point| text_fits(point, limit)),
            "规则要点为空或过长"
        );
    }
    Ok(())
}

fn normalize_groups(mut groups: Vec<Group>) -> Result<Vec<Group>> {
    validate_groups(&groups)?;
    for g in &mut groups {
        g.name = g.name.trim().to_owned();
        for list in [
            &mut g.include,
            &mut g.exclude,
            &mut g.disabled_include,
            &mut g.disabled_exclude,
        ] {
            let mut seen = HashSet::new();
            list.retain_mut(|item| {
                *item = item.trim().to_owned();
                seen.insert(item.clone())
            });
        }
    }
    Ok(groups)
}

fn compile_group(g: &Group) -> String {
    if g.id.starts_with("legacy-") && g.include.len() == 1 && g.exclude.is_empty() {
        return g.include[0].clone();
    }
    let mut text = format!("{}。{}。", g.name, g.include.join("；"));
    if !g.exclude.is_empty() {
        text.push_str("保留");
        text.push_str(&g.exclude.join("；"));
        text.push('。');
    }
    text
}

fn defaults() -> Result<Vec<Group>> {
    Ok(serde_json::from_str(include_str!(
        "../config/default-rules.json"
    ))?)
}

pub(crate) fn from_flat(rules: Vec<String>) -> Result<Vec<Group>> {
    ensure!(rules.len() <= 24, "最多可设置 24 条规则");
    let known = defaults()?;
    let mut groups = Vec::new();
    let mut seen = HashSet::new();
    for rule in &rules {
        let text = rule.trim();
        ensure!(text_fits(text, 280), "规则为空或过长");
        if !seen.insert(text) {
            continue;
        }
        if let Some(g) = known.iter().find(|g| compile_group(g) == text) {
            groups.push(g.clone());
        } else {
            let hash = hex::encode(Sha256::digest(text.as_bytes()));
            groups.push(Group {
                id: format!("legacy-{}", &hash[..20]),
                site: None,
                name: text.chars().take(60).collect(),
                enabled: true,
                include: vec![text.to_owned()],
                exclude: Vec::new(),
                disabled_include: Vec::new(),
                disabled_exclude: Vec::new(),
            });
        }
    }
    Ok(groups)
}

#[derive(Deserialize)]
#[serde(untagged)]
enum DiskConfig {
    Groups {
        #[serde(default)]
        scoped: bool,
        groups: Vec<Group>,
        #[serde(default)]
        examples: Vec<Example>,
    },
    Legacy(Vec<String>),
}

fn retain_examples(groups: &[Group], mut examples: Vec<Example>) -> Vec<Example> {
    examples.retain(|e| {
        groups.iter().any(|g| {
            g.id == e.group_id
                && match e.kind.as_str() {
                    "include" => g.include.contains(&e.point),
                    "exclude" => g.exclude.contains(&e.point),
                    _ => false,
                }
        })
    });
    examples.drain(..examples.len().saturating_sub(512));
    examples
}

fn pairing_token(directory: &Path) -> Result<String> {
    let path = directory.join("pairing-token");
    let token = match fs::read_to_string(&path) {
        Ok(token) => token,
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let mut bytes = [0; 24];
            getrandom::fill(&mut bytes).map_err(|e| eyre!("无法生成配对口令：{e}"))?;
            let token = hex::encode(bytes);
            let mut tmp = NamedTempFile::new_in(directory)?;
            tmp.write_all(token.as_bytes())?;
            tmp.as_file().sync_all()?;
            match tmp.persist_noclobber(&path) {
                Ok(_) => token,
                Err(err) if err.error.kind() == ErrorKind::AlreadyExists => {
                    fs::read_to_string(&path)?
                }
                Err(err) => return Err(err.into()),
            }
        }
        Err(err) => return Err(err.into()),
    };
    let token = token.trim();
    ensure!(
        token.len() == 48
            && token
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "本地配对口令文件无效"
    );
    Ok(token.to_owned())
}

struct Fingerprint {
    model: String,
    endpoint: String,
    prompt_version: String,
}

impl Fingerprint {
    fn settings(&self, groups: Vec<Group>, examples: &[Example]) -> Settings {
        let revision = digest(&(
            &groups,
            examples,
            &self.endpoint,
            &self.model,
            &self.prompt_version,
        ));
        let rules = groups
            .iter()
            .filter_map(Group::active)
            .map(|g| compile_group(&g))
            .collect();
        Settings {
            groups,
            rules,
            revision,
        }
    }
}

pub(crate) struct Store {
    pub token: String,
    pub settings: Settings,
    pub examples: Vec<Example>,
    directory: PathBuf,
    fingerprint: Fingerprint,
}

impl Store {
    pub(crate) fn for_site(&self, site: &str) -> Settings {
        let all = &self.settings.groups;
        if all.iter().all(|g| g.applies_to(site)) {
            return self.settings.clone();
        }
        let groups: Vec<_> = all.iter().filter(|g| g.applies_to(site)).cloned().collect();
        let examples = self
            .examples
            .iter()
            .filter(|e| groups.iter().any(|g| g.id == e.group_id))
            .cloned()
            .collect::<Vec<_>>();
        self.fingerprint.settings(groups, &examples)
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.directory
    }

    pub(crate) fn rebind_model(&mut self, model: &str, endpoint: &str, prompt_version: String) {
        self.fingerprint = Fingerprint {
            model: model.into(),
            endpoint: endpoint.into(),
            prompt_version,
        };
        self.settings = self
            .fingerprint
            .settings(self.settings.groups.clone(), &self.examples);
    }
    #[tracing::instrument(skip_all)]
    pub(crate) fn load(
        directory: &Path,
        model: &str,
        endpoint: &str,
        prompt_version: &str,
    ) -> Result<Self> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(directory).wrap_err("无法创建配置目录")?;
        let token = pairing_token(directory).wrap_err("无法读取或创建配对口令")?;
        let path = directory.join("rules.json");
        let (groups, examples, migrate) = match fs::read(path) {
            Ok(bytes) => match serde_json::from_slice(&bytes).wrap_err("规则文件不是有效的配置")?
            {
                DiskConfig::Groups {
                    mut groups,
                    examples,
                    scoped,
                } => {
                    if !scoped
                        && let Some(group) = groups
                            .iter_mut()
                            .find(|g| g.id == "post-video" && g.site.is_none())
                    {
                        group.site = Some(crate::plugins::LEGACY_SITE.into());
                    }
                    (groups, examples, !scoped)
                }
                DiskConfig::Legacy(flat) => (from_flat(flat)?, Vec::new(), true),
            },
            Err(err) if err.kind() == ErrorKind::NotFound => (defaults()?, Vec::new(), false),
            Err(err) => return Err(err).wrap_err("无法读取规则文件"),
        };
        let groups = normalize_groups(groups)?;
        let examples = retain_examples(&groups, examples);
        let fingerprint = Fingerprint {
            model: model.to_owned(),
            endpoint: endpoint.to_owned(),
            prompt_version: prompt_version.to_owned(),
        };
        let settings = fingerprint.settings(groups, &examples);
        let mut store = Self {
            token,
            settings,
            examples,
            directory: directory.to_owned(),
            fingerprint,
        };
        if migrate {
            store.save(store.settings.groups.clone(), store.examples.clone())?;
        }
        Ok(store)
    }

    #[tracing::instrument(skip_all)]
    pub(crate) fn save(&mut self, groups: Vec<Group>, examples: Vec<Example>) -> Result<()> {
        #[derive(Serialize)]
        struct Snapshot<'a> {
            scoped: bool,
            groups: &'a [Group],
            examples: &'a [Example],
        }
        let groups = normalize_groups(groups)?;
        let examples = retain_examples(&groups, examples);
        let mut tmp = NamedTempFile::new_in(&self.directory)?;
        serde_json::to_writer_pretty(
            &mut tmp,
            &Snapshot {
                scoped: true,
                groups: &groups,
                examples: &examples,
            },
        )?;
        tmp.write_all(b"\n")?;
        tmp.as_file().sync_all()?;
        tmp.persist(self.directory.join("rules.json"))
            .wrap_err("无法保存规则文件")?;
        self.settings = self.fingerprint.settings(groups, &examples);
        self.examples = examples;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(path: &Path) -> Result<Store> {
        Store::load(
            path,
            "test-model",
            "https://example.invalid/chat/completions",
            "test-prompt",
        )
    }

    #[test]
    fn old_groups_migrate_by_id_and_explicit_global_survives_restart() -> Result<()> {
        let tmp = tempfile::tempdir()?;
        let mut old = serde_json::to_value(defaults()?)?;
        old[2].as_object_mut().unwrap().remove("site");
        old[2]["name"] = serde_json::json!("我的截图规则");
        old.as_array_mut().unwrap().swap(0, 2);
        fs::write(
            tmp.path().join("rules.json"),
            serde_json::to_vec(&serde_json::json!({"groups":old}))?,
        )?;
        let mut store = load(tmp.path())?;
        assert_eq!(store.for_site("second").groups.len(), 2);
        let mut groups = store.for_site("bilibili").groups;
        assert_eq!(groups[0].name, "我的截图规则");
        assert_eq!(groups[0].site.as_deref(), Some("bilibili"));
        groups[0].site = None;
        store.save(groups, vec![])?;
        assert_eq!(load(tmp.path())?.for_site("second").groups.len(), 3);
        Ok(())
    }

    #[test]
    fn defaults_compile_enabled_groups_and_reject_invalid_inputs() -> Result<()> {
        let tmp = tempfile::tempdir()?;
        let mut store = load(tmp.path())?;
        assert_eq!(store.settings.rules.len(), 3);
        let mut groups = store.settings.groups.clone();
        groups[1].enabled = false;
        groups[0].include = vec!["  政治新闻  ".into(), "政治新闻".into()];
        store.save(groups, vec![])?;
        assert_eq!(store.settings.rules.len(), 2);
        assert_eq!(store.settings.groups[0].include, ["政治新闻"]);
        assert!(store.settings.rules[0].contains("保留"));
        let before = store.settings.clone();
        let file = tmp.path().join("rules.json");
        let bytes = fs::read(&file)?;
        let mut duplicated = before.groups.clone();
        duplicated.push(duplicated[0].clone());
        assert!(store.save(duplicated, vec![]).is_err());
        let mut missing = before.groups.clone();
        missing[0].include.clear();
        assert!(store.save(missing, vec![]).is_err());
        assert_eq!(store.settings, before);
        assert_eq!(fs::read(file)?, bytes);
        let reopened = load(tmp.path())?;
        assert_eq!(reopened.settings, before);
        assert_eq!(reopened.token, store.token);
        Ok(())
    }

    #[test]
    fn old_flat_files_preserve_legacy_ids_long_rules_and_token() -> Result<()> {
        let tmp = tempfile::tempdir()?;
        fs::write(tmp.path().join("pairing-token"), "ab".repeat(24) + "\n")?;
        let long = "旧".repeat(280);
        fs::write(
            tmp.path().join("rules.json"),
            serde_json::to_vec(&[" 旧规则 ", "旧规则", &long])?,
        )?;
        let mut store = load(tmp.path())?;
        assert_eq!(store.token, "ab".repeat(24));
        assert_eq!(store.settings.groups[0].id, "legacy-829ecbf59a292e0ad294");
        assert_eq!(store.settings.rules.as_slice(), ["旧规则", &long]);
        assert_eq!(store.settings.groups[1].name.chars().count(), 60);
        let mut edited = store.settings.groups.clone();
        edited[0].exclude.push("有出处的资料".into());
        store.save(edited, vec![])?;
        assert!(store.settings.rules[0].contains("保留有出处的资料"));
        assert_eq!(load(tmp.path())?.settings, store.settings);
        Ok(())
    }

    #[test]
    fn grouped_node_files_retain_matching_examples_until_point_changes() -> Result<()> {
        let tmp = tempfile::tempdir()?;
        let groups = from_flat(vec!["样例".into()])?;
        let example = serde_json::json!({
            "cardKey":"abcdef", "groupId":groups[0].id, "kind":"include", "point":"样例", "coverDigest":"1234"
        });
        let fixture = serde_json::json!({"groups":groups, "examples":[example]});
        fs::write(tmp.path().join("rules.json"), serde_json::to_vec(&fixture)?)?;
        let mut store = load(tmp.path())?;
        assert_eq!(store.examples.len(), 1);
        assert_eq!(store.examples[0].cover_digest.as_deref(), Some("1234"));
        let original = store.settings.revision.clone();
        let mut disabled = store.settings.groups.clone();
        disabled[0].enabled = false;
        store.save(disabled, store.examples.clone())?;
        assert_eq!(store.examples.len(), 1);
        assert!(store.settings.rules.is_empty());
        assert_ne!(store.settings.revision, original);
        let mut edited = store.settings.groups.clone();
        edited[0].include = vec!["新条件".into()];
        store.save(edited, store.examples.clone())?;
        assert!(load(tmp.path())?.examples.is_empty());
        Ok(())
    }

    #[test]
    fn digest_matches_node_and_card_validation_checks_identity_and_utf16_lengths() -> Result<()> {
        assert_eq!(
            digest(&["BV", "标题", "作者", "https://i1.hdslb.com/封面.png"]),
            "20c516cf4241d8efc8a90afa9300afcdcce608dbbb5237d79ddf29c6f5dd14d4"
        );
        let mut c: Card = serde_json::from_str(r#"{"id":"BV","title":"标题"}"#)?;
        validate_cards(std::slice::from_ref(&c), 512)?;
        assert!(validate_cards(&[c.clone(), c.clone()], 512).is_err());
        c.title = "🐟".repeat(257);
        assert!(validate_cards(&[c], 512).is_err());
        assert!(validate_cards(&[], 512).is_err());
        Ok(())
    }
}
