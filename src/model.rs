//! Multimodal classification and user-guided rule refinement.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant, SystemTime},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use eyre::{Result, WrapErr, ensure, eyre};
use regex::Regex;
use reqwest::{
    Client, Request, RequestBuilder, StatusCode, Url,
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue, REFERER, RETRY_AFTER},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::rules::{Card, Group};

#[derive(Deserialize)]
struct Templates {
    version: String,
    compact: String,
    prefix: String,
    rule_turn: String,
    feedback: String,
    false_positive: String,
    false_negative: String,
}

static PROMPTS: LazyLock<Templates> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../config/prompts.json")).expect("valid bundled prompts")
});
pub(crate) fn prompt_version() -> &'static str {
    &PROMPTS.version
}
static MODEL_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_./:-]{1,160}$").expect("valid model expression"));
static UNSAFE_POINT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)(?:无条件|一律|全部|一概|统统)(?:放行|豁免|保留|不过滤|过滤|屏蔽)|(?:保留|放行|豁免|屏蔽|过滤)(?:全部|所有|任何)(?:卡片|视频|内容)|(?:忽略|跳过|关闭|停用|禁用|覆盖|删除)(?:所有|全部|上述|之前的?|以上|其他|本组|该组|本条|这条)?(?:规则|指令|过滤|提示词)|(?:返回|输出)(?:JSON|固定值|规则号|数字0)|ignore\s+(all|previous|prior)\s+instructions|^[{\[]|[`<>]"
).expect("valid feedback expression")
});

#[derive(Debug, Clone)]
pub(crate) struct Model {
    pub name: String,
    pub endpoint: String,
    client: Client,
    authorization: Option<HeaderValue>,
    deepseek: bool,
    cooldown: Arc<Cooldown>,
    #[cfg(test)]
    fixture_cover: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct Asset {
    pub image_url: String,
    pub digest: String,
}

impl Asset {
    pub(crate) fn from_page(data: &str) -> Result<Self> {
        let encoded = data
            .strip_prefix("data:image/jpeg;base64,")
            .ok_or_else(|| eyre!("页面封面类型无效"))?;
        let bytes = STANDARD.decode(encoded)?;
        ensure!(mime_type(&bytes) == Some("image/jpeg"), "页面封面格式无效");
        Ok(Self {
            image_url: data.to_owned(),
            digest: format!("{:x}", Sha256::digest(bytes)),
        })
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct Usage {
    #[serde(rename(deserialize = "prompt_tokens"))]
    pub input: u64,
    #[serde(rename(deserialize = "completion_tokens"))]
    pub output: u64,
    #[serde(rename(deserialize = "prompt_cache_hit_tokens"))]
    pub cached: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Correction {
    pub group_id: String,
    pub point: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Reflection {
    pub reason: String,
    pub corrections: Vec<Correction>,
    #[serde(skip_deserializing)]
    pub usage: Usage,
}

fn endpoint_for(base: &str) -> Result<(String, bool)> {
    let url = Url::parse(base).wrap_err("模型地址无效")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    ensure!(
        (url.scheme() == "https" || (local && url.scheme() == "http"))
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "模型地址需要 HTTPS 或本机 HTTP"
    );
    let deepseek = url.origin().ascii_serialization() == "https://api.deepseek.com";
    Ok((
        format!("{}/chat/completions", url.as_str().trim_end_matches('/')),
        deepseek,
    ))
}

fn mime_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

struct Reply {
    bytes: Vec<u8>,
    content_type: String,
}

struct AttemptError {
    reason: eyre::Report,
    retry: bool,
    after: Option<Duration>,
    rate_limited: bool,
}

impl From<reqwest::Error> for AttemptError {
    fn from(error: reqwest::Error) -> Self {
        Self {
            reason: eyre!("网络请求失败"),
            retry: !error.is_builder(),
            after: None,
            rate_limited: false,
        }
    }
}

fn server_delay(header: Option<&HeaderValue>) -> Option<Duration> {
    let text = header?.to_str().ok()?.trim();
    if let Ok(seconds) = text.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let time = httpdate::parse_http_date(text).ok()?;
    Some(time.duration_since(SystemTime::now()).unwrap_or_default())
}

fn retryable_status(status: StatusCode) -> bool {
    status.is_server_error()
        || matches!(
            status,
            StatusCode::REQUEST_TIMEOUT | StatusCode::TOO_MANY_REQUESTS
        )
}

fn retry_delay(attempt: u32, after: Option<Duration>) -> Duration {
    let base = 500_u64 << attempt;
    let jitter = fastrand::u64(0..=250);
    Duration::from_millis(base + jitter).max(after.unwrap_or_default())
}

#[derive(Debug, Default)]
struct Cooldown(Mutex<Option<(Instant, Duration)>>);

impl Cooldown {
    fn remaining(window: Option<(Instant, Duration)>) -> Duration {
        window
            .map(|(start, delay)| delay.saturating_sub(start.elapsed()))
            .unwrap_or_default()
    }

    fn extend(&self, delay: Duration) {
        let mut window = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if delay > Self::remaining(*window) {
            *window = Some((Instant::now(), delay));
        }
    }

    async fn wait(&self, deadline: Instant) -> Result<()> {
        loop {
            let remaining =
                Self::remaining(*self.0.lock().unwrap_or_else(|error| error.into_inner()));
            if remaining.is_zero() {
                return Ok(());
            }
            ensure!(
                remaining < deadline.saturating_duration_since(Instant::now()),
                "HTTP 429：模型限流等待超出本次截止时间"
            );
            tokio::time::sleep(remaining).await;
        }
    }
}

async fn one_attempt(
    client: &Client,
    request: Request,
    limit: usize,
) -> std::result::Result<Reply, AttemptError> {
    let mut response = client.execute(request).await?;
    let status = response.status();
    if !status.is_success() {
        return Err(AttemptError {
            reason: eyre!("HTTP {}", status.as_u16()),
            retry: retryable_status(status),
            after: server_delay(response.headers().get(RETRY_AFTER)),
            rate_limited: status == StatusCode::TOO_MANY_REQUESTS,
        });
    }
    let too_large = || AttemptError {
        reason: eyre!("响应超过大小限制"),
        retry: false,
        after: None,
        rate_limited: false,
    };
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(too_large());
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > limit - bytes.len() {
            return Err(too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Reply {
        bytes,
        content_type,
    })
}

fn image_part(asset: &Asset) -> Value {
    json!({"type":"image_url","image_url":{"url":asset.image_url,"detail":"low"}})
}

fn rule_turn(site: &str, rules: &[String]) -> Result<Vec<Value>> {
    let numbered: Vec<_> = rules
        .iter()
        .enumerate()
        .map(|(i, rule)| (i + 1, rule))
        .collect();
    let text = PROMPTS
        .rule_turn
        .replace("{rules}", &serde_json::to_string(&numbered)?);
    Ok(vec![
        json!({"role":"system","content":PROMPTS.compact}),
        json!({"role":"user","content":format!("站点 {site}\n{text}")}),
    ])
}

fn content_parts(text: String, asset: Option<&Asset>) -> Vec<Value> {
    let mut parts = vec![json!({"type":"text","text":text})];
    parts.extend(asset.map(image_part));
    parts
}

fn card_parts(card: &Card, asset: Option<&Asset>) -> Vec<Value> {
    let prefix = if asset.is_some() {
        PROMPTS.prefix.as_str()
    } else {
        "本帖 [序号,正文,作者?]。按可见文字判断。"
    };
    let row = if card.author.is_empty() {
        json!([1, card.title])
    } else {
        json!([1, card.title, card.author])
    };
    content_parts(format!("{prefix}\n{row}"), asset)
}

fn decisions(text: &str, count: usize, rule_count: usize) -> Result<Vec<Vec<i32>>> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Decision {
        Single(i32),
        Multiple(Vec<i32>),
        Bits(String),
    }
    #[derive(Deserialize)]
    struct Output {
        v: Vec<Decision>,
    }
    let output: Output = serde_json::from_str(text).wrap_err("模型判断 JSON 无效")?;
    ensure!(output.v.len() == count, "模型判断与卡片数不符");
    output
        .v
        .into_iter()
        .map(|decision| {
            let mut ids = match decision {
                Decision::Single(n) => vec![n],
                Decision::Multiple(ids) => ids,
                Decision::Bits(bits) if bits == "?" => vec![-1],
                Decision::Bits(bits) => {
                    ensure!(
                        bits.len() == rule_count
                            && !bits.is_empty()
                            && bits.bytes().all(|b| matches!(b, b'0' | b'1')),
                        "规则位串无效"
                    );
                    let hits: Vec<_> = bits
                        .bytes()
                        .enumerate()
                        .filter(|(_, b)| *b == b'1')
                        .map(|(i, _)| i32::try_from(i + 1))
                        .collect::<std::result::Result<_, _>>()?;
                    if hits.is_empty() { vec![0] } else { hits }
                }
            };
            if !matches!(ids.as_slice(), [0] | [-1]) {
                ensure!(
                    !ids.is_empty()
                        && ids
                            .iter()
                            .all(|&n| n > 0 && usize::try_from(n).is_ok_and(|n| n <= rule_count)),
                    "模型返回无效规则编号"
                );
                ids.sort_unstable();
                ids.dedup();
            }
            Ok(ids)
        })
        .collect()
}

fn plain_text(text: &str, limit: usize) -> bool {
    !text.trim().is_empty()
        && text.trim().chars().count() <= limit
        && !text.chars().any(|ch| {
            ch.is_control() || matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
}

fn comparable(text: &str) -> String {
    static SEPARATORS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[\p{P}\s]").expect("valid separators"));
    SEPARATORS
        .replace_all(&text.to_lowercase(), "")
        .into_owned()
}

fn validate_reflection(
    text: &str,
    card: &Card,
    groups: &[Group],
    positive: bool,
    usage: Usage,
) -> Result<Reflection> {
    let mut answer: Reflection = serde_json::from_str(text).wrap_err("反馈分析 JSON 无效")?;
    ensure!(plain_text(&answer.reason, 240), "反馈原因无效");
    ensure!(
        answer.corrections.len() == groups.len(),
        "反馈分析未覆盖全部组"
    );
    let mut points = HashMap::new();
    for correction in answer.corrections {
        ensure!(
            points
                .insert(correction.group_id, correction.point)
                .is_none(),
            "反馈分析包含重复组"
        );
    }
    answer.corrections = groups
        .iter()
        .map(|g| {
            let point = points
                .remove(&g.id)
                .ok_or_else(|| eyre!("反馈分析组不匹配"))?;
            ensure!(
                plain_text(&point, 100) && !UNSAFE_POINT.is_match(&point),
                "反馈要点无效"
            );
            let opposite = if positive { &g.exclude } else { &g.include };
            let key = comparable(&point);
            ensure!(
                !key.is_empty()
                    && [&card.title, &card.author, &g.name]
                        .into_iter()
                        .chain(opposite)
                        .all(|s| comparable(s) != key),
                "反馈要点缺少限定条件"
            );
            Ok(Correction {
                group_id: g.id.clone(),
                point: point.trim().into(),
            })
        })
        .collect::<Result<_>>()?;
    answer.reason = answer.reason.trim().into();
    answer.usage = usage;
    Ok(answer)
}

#[derive(Deserialize)]
struct ChatResult {
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Usage,
}
#[derive(Deserialize)]
struct Choice {
    finish_reason: String,
    message: Message,
}
#[derive(Deserialize)]
struct Message {
    content: String,
}

impl Model {
    #[cfg(test)]
    pub(crate) fn from_env() -> Result<Self> {
        use std::env;
        let base =
            env::var("COGNITION_API_BASE").unwrap_or_else(|_| "https://api.deepseek.com/".into());
        let (_, deepseek) = endpoint_for(&base)?;
        let name = env::var("COGNITION_MODEL").unwrap_or_else(|_| "deepseek-flash".into());
        let configured_key = env::var("COGNITION_API_KEY")
            .ok()
            .filter(|key| !key.trim().is_empty())
            .or_else(|| {
                deepseek
                    .then(|| env::var("DEEPSEEK_API_KEY").ok())
                    .flatten()
            })
            .filter(|key| !key.trim().is_empty());
        Self::new(
            &base,
            &name,
            &configured_key.ok_or_else(|| eyre!("真实模型测试需要 API Key"))?,
        )
    }

    pub(crate) fn from_config(config: &crate::config::Config) -> Result<Self> {
        Self::new(&config.endpoint, &config.model, config.api_key())
    }

    pub(crate) fn can_prewarm(&self) -> bool {
        self.deepseek && self.configured()
    }

    pub(crate) async fn prewarm(&self, site: &str, rules: &[String]) -> Result<(String, Usage)> {
        // Even if the provider formats the acknowledgement differently, the complete
        // system and user input remains an identical cacheable prefix in every branch.
        let (reply, usage) = self.completion(rule_turn(site, rules)?, 12).await?;
        let acknowledgement =
            if reply.len() <= 48 && serde_json::from_str::<Value>(&reply).ok() == Some(json!({})) {
                reply
            } else {
                "{}".into()
            };
        Ok((acknowledgement, usage))
    }

    pub(crate) fn configured(&self) -> bool {
        self.authorization.is_some()
    }

    fn new(base: &str, name: &str, key: &str) -> Result<Self> {
        let (endpoint, deepseek) = endpoint_for(base)?;
        ensure!(MODEL_NAME.is_match(name), "模型名称无效");
        let authorization = if key.trim().is_empty() {
            None
        } else {
            let mut header = HeaderValue::from_str(&format!("Bearer {}", key.trim()))
                .map_err(|_| eyre!("API Key 格式无效"))?;
            header.set_sensitive(true);
            Some(header)
        };
        let client = Client::builder()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .user_agent(concat!(
                env!("CARGO_PKG_NAME"),
                "/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .wrap_err("初始化 HTTP 客户端失败")?;
        Ok(Self {
            name: name.to_owned(),
            endpoint,
            client,
            authorization,
            deepseek,
            cooldown: Arc::default(),
            #[cfg(test)]
            fixture_cover: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn fixture(base: &str, deepseek: bool) -> Result<Self> {
        Ok(Self {
            name: "test-vision".into(),
            endpoint: format!("{base}/chat/completions"),
            client: Client::builder()
                .no_proxy()
                .retry(reqwest::retry::never())
                .redirect(Policy::none())
                .build()?,
            authorization: Some(HeaderValue::from_static("Bearer test")),
            deepseek,
            cooldown: Arc::default(),
            fixture_cover: Some(format!("{base}/cover")),
        })
    }

    async fn request(
        &self,
        request: RequestBuilder,
        limit: usize,
        total: Duration,
        per_try: Duration,
        cooldown: Option<&Cooldown>,
    ) -> Result<Reply> {
        let template = request.build().wrap_err("请求无效")?;
        let deadline = Instant::now() + total;
        for attempt in 0..3 {
            if let Some(cooldown) = cooldown {
                cooldown.wait(deadline).await?;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            ensure!(!remaining.is_zero(), "请求已超时");
            let mut next = template
                .try_clone()
                .ok_or_else(|| eyre!("请求体不可重试"))?;
            *next.timeout_mut() = Some(per_try.min(remaining));
            match one_attempt(&self.client, next, limit).await {
                Ok(reply) => return Ok(reply),
                Err(error) => {
                    let delay = retry_delay(attempt, error.after);
                    if error.rate_limited
                        && let Some(cooldown) = cooldown
                    {
                        cooldown.extend(delay);
                    }
                    if !error.retry || attempt == 2 {
                        return Err(error.reason);
                    }
                    if delay >= deadline.saturating_duration_since(Instant::now()) {
                        return Err(error.reason);
                    }
                    tracing::debug!(
                        attempt = attempt + 1,
                        delay_ms = delay.as_millis(),
                        "retrying external request"
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
        unreachable!("the third attempt always returns")
    }

    #[tracing::instrument(skip_all)]
    pub(crate) async fn cover(&self, site: &crate::plugins::Site, url: &str) -> Result<Asset> {
        let (target, referer) = site.thumbnail(url)?;
        #[cfg(test)]
        let target = self.fixture_cover.clone().unwrap_or(target);
        let request = self
            .client
            .get(target)
            .header(ACCEPT, "image/webp,image/jpeg,image/png,image/gif");
        let request = if let Some(referer) = referer {
            request.header(REFERER, referer)
        } else {
            request
        };
        let reply = self
            .request(
                request,
                2 * 1024 * 1024,
                Duration::from_secs(16),
                Duration::from_secs(7),
                None,
            )
            .await
            .wrap_err("读取站点封面失败")?;
        let mime = mime_type(&reply.bytes).ok_or_else(|| eyre!("封面格式无效"))?;
        ensure!(mime == reply.content_type, "封面类型与内容不符");
        Ok(Asset {
            image_url: format!("data:{mime};base64,{}", STANDARD.encode(&reply.bytes)),
            digest: format!("{:x}", Sha256::digest(&reply.bytes)),
        })
    }

    async fn chat(
        &self,
        system: &str,
        parts: Vec<Value>,
        max_tokens: usize,
    ) -> Result<(String, Usage)> {
        self.completion(
            vec![
                json!({"role":"system","content":system}),
                json!({"role":"user","content":parts}),
            ],
            max_tokens,
        )
        .await
    }

    async fn completion(&self, messages: Vec<Value>, max_tokens: usize) -> Result<(String, Usage)> {
        let mut payload = json!({
            "model":self.name, "temperature":0, "max_tokens":max_tokens,
            "response_format":{"type":"json_object"},
            "messages":messages
        });
        if self.deepseek {
            payload["thinking"] = json!({"type":"disabled"});
        }
        let request = self
            .client
            .post(&self.endpoint)
            .header(
                AUTHORIZATION,
                self.authorization
                    .clone()
                    .ok_or_else(|| eyre!("请先在托盘设置中填写 API Key"))?,
            )
            .json(&payload);
        let reply = self
            .request(
                request,
                1024 * 1024,
                Duration::from_secs(55),
                Duration::from_secs(25),
                Some(&self.cooldown),
            )
            .await?;
        let output: ChatResult = serde_json::from_slice(&reply.bytes).wrap_err("模型响应无效")?;
        let first = output
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| eyre!("模型响应为空"))?;
        ensure!(first.finish_reason == "stop", "模型响应未完成");
        Ok((first.message.content, output.usage))
    }

    #[tracing::instrument(skip_all, fields(rules = rules.len()))]
    pub(crate) async fn classify(
        &self,
        site: &str,
        rules: &[String],
        card: &Card,
        asset: Option<&Asset>,
        acknowledgement: &str,
    ) -> Result<(Vec<i32>, Usage)> {
        let mut messages = rule_turn(site, rules)?;
        messages.push(json!({"role":"assistant","content":acknowledgement}));
        messages.push(json!({"role":"user","content":card_parts(card, asset)}));
        let (output, usage) = self.completion(messages, 50 + 3 * rules.len()).await?;
        Ok((decisions(&output, 1, rules.len())?.remove(0), usage))
    }

    #[tracing::instrument(skip_all, fields(positive, groups = groups.len()))]
    pub(crate) async fn reflect(
        &self,
        card: &Card,
        asset: Option<&Asset>,
        groups: &[Group],
        positive: bool,
    ) -> Result<Reflection> {
        ensure!(
            !groups.is_empty()
                && groups.len() <= 24
                && groups.iter().map(|g| &g.id).collect::<HashSet<_>>().len() == groups.len(),
            "反馈分析需要有效的所选组"
        );
        let input = json!({
            "groups":groups.iter().map(|g| json!({"id":g.id,"name":g.name,"include":g.include,"exclude":g.exclude})).collect::<Vec<_>>(),
            "card":{"title":card.title,"author":card.author}
        });
        let parts = content_parts(input.to_string(), asset);
        let objective = if positive {
            &PROMPTS.false_negative
        } else {
            &PROMPTS.false_positive
        };
        let system = format!("{objective}{}", PROMPTS.feedback);
        let (output, usage) = self.chat(&system, parts, 320 + 220 * groups.len()).await?;
        validate_reflection(&output, card, groups, positive, usage)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use axum::{Router, routing::post};
    use tokio::net::TcpListener;

    use super::*;

    fn live_cards() -> Result<Vec<(Card, Asset, Vec<i32>)>> {
        let suite: Value = serde_json::from_str(include_str!("../eval/user-feedback.json"))?;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("eval");
        let mut cards = Vec::new();
        for value in suite[0]["cards"]
            .as_array()
            .ok_or_else(|| eyre!("invalid live suite"))?
        {
            let card: Card = serde_json::from_value(value.clone())?;
            let bytes = std::fs::read(root.join(&card.cover))?;
            let mime = mime_type(&bytes).ok_or_else(|| eyre!("invalid live cover"))?;
            let asset = Asset {
                image_url: format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
                digest: format!("{:x}", Sha256::digest(bytes)),
            };
            let labels = decisions(&json!({"v":[value["expected"]]}).to_string(), 1, 3)?.remove(0);
            cards.push((card, asset, labels));
        }
        Ok(cards)
    }

    #[tokio::test]
    #[ignore = "sends five labeled covers to the configured multimodal API"]
    async fn live_smoke_classify_user_covers() -> Result<()> {
        let model = Model::from_env()?;
        let temp = tempfile::tempdir()?;
        let settings =
            crate::rules::Store::load(temp.path(), &model.name, &model.endpoint, prompt_version())?
                .settings;
        let rows = live_cards()?;
        let rows: Vec<_> = rows
            .iter()
            .filter(|(c, _, _)| c.id.starts_with("feedback-"))
            .collect();
        ensure!(rows.len() == 5, "expected five labeled user covers");
        let cards: Vec<_> = rows.iter().map(|(c, asset, _)| (c, asset)).collect();
        let mut found = Vec::new();
        let mut totals = (0, 0, 0);
        let (ack, warm) = model.prewarm("bilibili", &settings.rules).await?;
        println!(
            "warm input={} cached={} output={}",
            warm.input, warm.cached, warm.output
        );
        let branches = cards.iter().map(|(card, asset)| {
            model.classify("bilibili", &settings.rules, card, Some(asset), &ack)
        });
        for branch in futures_util::future::join_all(branches).await {
            let (decision, usage) = branch?;
            println!(
                "branch cards=1 input={} cached={} output={}",
                usage.input, usage.cached, usage.output
            );
            found.push(decision);
            totals.0 += usage.input;
            totals.1 += usage.output;
            totals.2 += usage.cached;
        }
        let mut exact = 0;
        for ((card, _, expected), actual) in rows.iter().zip(&found) {
            println!("{} expected={expected:?} actual={actual:?}", card.id);
            exact += usize::from(expected == actual);
        }
        println!(
            "exact={exact}/{} input={} output={} cached={}",
            rows.len(),
            totals.0,
            totals.1,
            totals.2
        );
        ensure!(
            exact == rows.len(),
            "model label sets differ from user annotations"
        );
        Ok(())
    }

    #[tokio::test]
    #[ignore = "sends two visual feedback examples to the configured multimodal API"]
    async fn live_smoke_reflect_both_directions() -> Result<()> {
        let model = Model::from_env()?;
        let groups: Vec<Group> =
            serde_json::from_str(include_str!("../config/default-rules.json"))?;
        let cards = live_cards()?;
        let reports = [
            ("control-fishing-vlog", "post-video", false),
            ("feedback-school-comments", "division", true),
        ];
        for (id, group_id, positive) in reports {
            let (card, asset, _) = cards
                .iter()
                .find(|(card, _, _)| card.id == id)
                .ok_or_else(|| eyre!("missing test card"))?;
            let group = groups
                .iter()
                .find(|group| group.id == group_id)
                .ok_or_else(|| eyre!("missing test group"))?;
            let answer = model
                .reflect(card, Some(asset), std::slice::from_ref(group), positive)
                .await?;
            ensure!(answer.corrections.len() == 1 && answer.corrections[0].group_id == group_id);
            println!(
                "{id} positive={positive} group={group_id} reason={} point={} input={} output={}",
                answer.reason, answer.corrections[0].point, answer.usage.input, answer.usage.output
            );
        }
        Ok(())
    }

    #[test]
    fn config_and_thumbnail_domains() {
        assert!(
            endpoint_for("https://third-party.example/v1/")
                .is_ok_and(|(e, d)| !d && e.ends_with("/v1/chat/completions"))
        );
        assert!(endpoint_for("https://api.deepseek.com/v1").unwrap().1);
        assert!(endpoint_for("http://127.0.0.1:8000/v1").is_ok());
        for url in [
            "http://remote.example",
            "https://key@api.deepseek.com",
            "https://api.deepseek.com?q=x",
        ] {
            assert!(endpoint_for(url).is_err());
        }
        let sites = crate::plugins::Sites::fixture();
        let site = &sites.entries["bilibili"];
        let source = "//i2.hdslb.com/bfs/archive/abc.jpg@672w.avif?tracking=1";
        assert_eq!(
            site.thumbnail(source).unwrap().0,
            "https://i2.hdslb.com/bfs/archive/abc.jpg@512w_80q.webp"
        );
        for bad in [
            "https://other.example/bfs/test.jpg",
            "https://usr@i1.hdslb.com/bfs/img.jpg",
            "//i0.hdslb.com:8000/bfs/img.jpg",
            "//i0.hdslb.com/path/img.jpg",
        ] {
            assert!(site.thumbnail(bad).is_err());
        }
        assert_eq!(mime_type(b"RIFF0000WEBP"), Some("image/webp"));
        assert_eq!(mime_type(b"<html>"), None);
    }

    #[test]
    fn classify_checks_full_batch_and_canonicalizes_multilabel() {
        assert_eq!(
            decisions(r#"{"v":["010","011","000","?"]}"#, 4, 3).unwrap(),
            vec![vec![2], vec![2, 3], vec![0], vec![-1]]
        );
        assert_eq!(
            decisions(r#"{"v":[[2,3,2],0,[-1]]}"#, 3, 3).unwrap(),
            vec![vec![2, 3], vec![0], vec![-1]]
        );
        for sample in [
            r#"{"v":[0,1]}"#,
            r#"{"v":[[0,1]]}"#,
            r#"{"v":[[]]}"#,
            r#"{"v":["2"]}"#,
            r#"{"v":["01"]}"#,
            r#"{"v":["012"]}"#,
            r#"{"v":["???"]}"#,
            r#"{"v":[""]}"#,
            r#"{"v":[4]}"#,
        ] {
            assert!(decisions(sample, 1, 3).is_err());
        }
    }

    #[tokio::test]
    async fn rate_limit_cooldown_applies_to_other_calls_on_the_same_model_only() {
        use axum::routing::get;
        let calls = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&calls);
        let app = Router::new()
            .route(
                "/chat/completions",
                post(move || {
                    count.fetch_add(1, Ordering::Relaxed);
                    async { (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "3600")]) }
                }),
            )
            .route(
                "/cover",
                get(|| async {
                    (
                        [("content-type", "image/png")],
                        b"\x89PNG\r\n\x1a\n".as_slice(),
                    )
                }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let model = Model::fixture(&origin, false).unwrap();
        let other_request = model.clone();
        assert!(model.chat("test", vec![], 10).await.is_err());
        assert!(other_request.chat("test", vec![], 10).await.is_err());
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert!(
            model
                .cover(
                    &crate::plugins::Sites::fixture().entries["bilibili"],
                    "https://i1.hdslb.com/bfs/archive/test.png"
                )
                .await
                .is_ok()
        );
        let separate = Model::fixture(&origin, false).unwrap();
        assert!(separate.chat("test", vec![], 10).await.is_err());
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        server.abort();
    }

    #[test]
    fn feedback_is_scoped_to_selected_groups_and_direction() {
        let card = serde_json::from_value(json!({"id":"x","title":"修复旧报纸实拍"})).unwrap();
        let group: Group = serde_json::from_value(json!({
            "id":"post","name":"网文搬运","enabled":true,
            "include":["朗读整页读者留言"],"exclude":["纸张修复演示"]
        }))
        .unwrap();
        let groups = [group];
        for positive in [true, false] {
            let point = if positive {
                "用报面读者来信栏目逐段朗读作主体"
            } else {
                "展示修复流程时拍下报纸文字以作前后对比"
            };
            let output = |id: &str, p: &str| {
                json!({"reason":"标题与封面提供了用途线索","corrections":[{"groupId":id,"point":p}]}).to_string()
            };
            assert_eq!(
                validate_reflection(
                    &output("post", point),
                    &card,
                    &groups,
                    positive,
                    Usage::default()
                )
                .unwrap()
                .corrections[0]
                    .point,
                point
            );
            for invalid in [
                output("other", point),
                output("post", "无条件屏蔽"),
                output("post", "修复旧报纸实拍"),
                output(
                    "post",
                    if positive {
                        "纸张修复演示"
                    } else {
                        "朗读整页读者留言"
                    },
                ),
            ] {
                assert!(
                    validate_reflection(&invalid, &card, &groups, positive, Usage::default())
                        .is_err()
                );
            }
        }
    }

    #[test]
    fn backoff_honors_server_dates_and_status() {
        assert_eq!(
            server_delay(Some(&HeaderValue::from_static("7"))),
            Some(Duration::from_secs(7))
        );
        assert_eq!(
            server_delay(Some(&HeaderValue::from_static(
                "Sun, 06 Nov 1994 08:49:37 GMT"
            ))),
            Some(Duration::ZERO)
        );
        assert_eq!(
            retry_delay(0, Some(Duration::from_secs(2))),
            Duration::from_secs(2)
        );
        assert!((500..=750).contains(&retry_delay(0, None).as_millis()));
        assert!((1000..=1250).contains(&retry_delay(1, None).as_millis()));
        assert!(retryable_status(StatusCode::REQUEST_TIMEOUT));
        assert!(!retryable_status(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn transient_responses_retry_auth_and_long_retry_after_return_immediately() {
        let calls = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&calls);
        let app = Router::new().route(
            "/retry",
            post(move || {
                let attempt = count.fetch_add(1, Ordering::Relaxed);
                async move {
                    match attempt {
                        0 => StatusCode::TOO_MANY_REQUESTS,
                        1 => StatusCode::SERVICE_UNAVAILABLE,
                        _ => StatusCode::OK,
                    }
                }
            }),
        );
        let count = Arc::clone(&calls);
        let app = app.route(
            "/auth",
            post(move || {
                count.fetch_add(1, Ordering::Relaxed);
                async { StatusCode::UNAUTHORIZED }
            }),
        );
        let count = Arc::clone(&calls);
        let app = app.route(
            "/later",
            post(move || {
                count.fetch_add(1, Ordering::Relaxed);
                async { (StatusCode::TOO_MANY_REQUESTS, [("retry-after", "3600")]) }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let model = Model::fixture(&origin, false).unwrap();
        let request = |path: &str| {
            model.request(
                model.client.post(format!("{origin}{path}")),
                100,
                Duration::from_secs(5),
                Duration::from_secs(2),
                None,
            )
        };
        assert!(request("/retry").await.is_ok());
        assert_eq!(calls.load(Ordering::Relaxed), 3);
        assert!(request("/auth").await.is_err());
        assert!(request("/later").await.is_err());
        assert_eq!(calls.load(Ordering::Relaxed), 5);
        server.abort();
    }
}
