//! Bilibili desktop homepage filter.
use std::sync::LazyLock;

const TEMPLATE: &str = include_str!("../bilibili.user.js");
static SCRIPT: LazyLock<String> =
    LazyLock::new(|| cf_site_sdk::bundle_script("bilibili", TEMPLATE));

cf_site_sdk::export_site!(include_bytes!("../site.json"), SCRIPT.as_bytes());
