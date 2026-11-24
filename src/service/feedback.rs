use super::{Api, ApiError, App, State, bad, busy, card_key, conflict, save_and_warm};
use crate::{
    plugins::Site,
    rules::{Card, Example, Group, digest, validate_cards, validate_groups},
};
use axum::{Extension, Json, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Feedback {
    card: Card,
    revision: String,
    group_id: Option<String>,
    new_group: Option<Group>,
}
pub(super) async fn report(
    State(app): State<App>,
    Extension(site): Extension<Arc<Site>>,
    Json(p): Json<Feedback>,
) -> Api {
    update(app, site, p, false).await
}
pub(super) async fn pick(
    State(app): State<App>,
    Extension(site): Extension<Arc<Site>>,
    Json(p): Json<Feedback>,
) -> Api {
    update(app, site, p, true).await
}

#[tracing::instrument(skip_all)]
async fn update(app: App, site: Arc<Site>, p: Feedback, positive: bool) -> Api {
    validate_cards(
        std::slice::from_ref(&p.card),
        site.text_post_limit.unwrap_or(512),
    )
    .map_err(bad)?;
    let _permit = app.feedback_slots.try_acquire().map_err(|_| busy())?;
    // Serialize feedback so a retried write observes the completed operation before spending tokens.
    let _writer = app.feedback_write.lock().await;
    let backend = app.backend.read().await;
    let op = digest(&(&site.id, positive, &p));
    let card_hash = card_key(&site, &p.card);
    let (mut groups, original_revision, receipt) = {
        let rt = app.lock();
        let revision = rt.store.for_site(&site.id).revision;
        if let Some(done) = rt.completed.get(&op)
            && done["revision"] == revision
        {
            return Ok(Json(done.clone()));
        }
        if p.revision != revision {
            return Err(conflict());
        }
        (
            rt.store.settings.groups.clone(),
            rt.store.settings.revision.clone(),
            rt.receipts
                .get(&digest(&(&p.revision, &card_hash)))
                .cloned(),
        )
    };
    let mut cover_digest = receipt.as_ref().and_then(|s| s.cover_digest.clone());
    let kind = if positive { "include" } else { "exclude" };
    let mut changes = Vec::<(String, String)>::new();
    let analysis;
    if let Some(mut new_group) = p.new_group {
        if !positive
            || !new_group.enabled
            || !new_group.disabled_include.is_empty()
            || !new_group.disabled_exclude.is_empty()
            || p.group_id.is_some()
        {
            return Err(bad("请指定一个启用的新规则组"));
        }
        let group_id = new_group.id.clone();
        new_group.site = Some(site.id.clone());
        groups.push(new_group);
        validate_groups(&groups).map_err(bad)?;
        changes.push((
            group_id,
            groups.last().expect("new group").include[0]
                .trim()
                .to_owned(),
        ));
        analysis = "已保存你填写的命中要点，并标记这张卡片。".to_owned();
    } else {
        let previous = receipt
            .as_ref()
            .map(|r| r.group_ids.as_slice())
            .unwrap_or_default();
        let ids = if positive {
            let id = p.group_id.as_ref().ok_or_else(|| bad("请选择已有规则"))?;
            if previous.contains(id) {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "该卡片已命中所选规则".into(),
                ));
            }
            std::slice::from_ref(id)
        } else {
            if p.group_id.is_some() || previous.is_empty() {
                return Err(conflict());
            }
            previous
        };
        let targets = groups
            .iter()
            .filter(|g| g.applies_to(&site.id) && ids.contains(&g.id))
            .filter_map(Group::active)
            .collect::<Vec<_>>();
        if targets.len() != ids.len() || targets.is_empty() {
            return Err(conflict());
        }
        if groups.iter().filter(|g| ids.contains(&g.id)).any(|g| {
            if positive {
                g.include.len() >= 8
            } else {
                g.exclude.len() >= 8
            }
        }) {
            return Err(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "这组要点已满，请先在编辑器中合并或删除一条".into(),
            ));
        }
        let asset = backend.cover(&site, &p.card).await.map_err(|_| {
            ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "封面暂不可读取，可稍后重试".into(),
            )
        })?;
        let actual = asset.as_ref().map(|a| a.digest.clone());
        if cover_digest.is_some() && cover_digest != actual {
            return Err(conflict());
        }
        cover_digest = actual;
        app.lock().stats.site(&site.id).reflection_calls += 1;
        let _upstream = backend.model_slots.acquire().await.map_err(|_| busy())?;
        let result = backend
            .model
            .reflect(&p.card, asset.as_ref(), &targets, positive)
            .await
            .map_err(|_| {
                ApiError(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "模型分析未完成，规则尚未更改，可稍后重试".into(),
                )
            })?;
        app.lock().stats.site(&site.id).add(&result.usage);
        analysis = result.reason;
        for correction in result.corrections {
            let group = groups
                .iter_mut()
                .find(|g| g.id == correction.group_id)
                .ok_or_else(conflict)?;
            let disabled = if positive {
                &group.disabled_include
            } else {
                &group.disabled_exclude
            };
            if disabled.contains(&correction.point) {
                return Err(bad("模型建议的要点已被手动禁用"));
            }
            let list = if positive {
                &mut group.include
            } else {
                &mut group.exclude
            };
            if !list.contains(&correction.point) {
                list.push(correction.point.clone());
            }
            changes.push((group.id.clone(), correction.point));
        }
    }
    let mut rt = app.lock();
    if rt.store.settings.revision != original_revision {
        return Err(conflict());
    }
    validate_groups(&groups).map_err(bad)?;
    let mut examples = rt.store.examples.clone();
    let mut corrections = Vec::with_capacity(changes.len());
    for (id, point) in changes {
        examples.retain(|e| e.card_key != card_hash || e.group_id != id);
        let name = groups
            .iter()
            .find(|g| g.id == id)
            .ok_or_else(conflict)?
            .name
            .trim();
        corrections.push(json!({"groupId":id,"groupName":name,"point":point}));
        examples.push(Example {
            card_key: card_hash.clone(),
            group_id: id,
            point,
            kind: kind.into(),
            cover_digest: cover_digest.clone(),
        });
    }
    save_and_warm(&app, &mut rt.store, groups, examples)?;
    if positive {
        rt.stats.site(&site.id).picked += 1;
    } else {
        rt.stats.site(&site.id).reported += 1;
    }
    let response = json!({"revision":rt.store.for_site(&site.id).revision,"analysis":analysis,"corrections":corrections,
        "message":if positive {"已保存命中要点"} else {"已保存保留例外"}});
    rt.completed.put(op, response.clone());
    Ok(Json(response))
}
