//! X home timeline filter.
use std::sync::LazyLock;

const TEMPLATE: &str = include_str!("../x.user.js");
static SCRIPT: LazyLock<String> = LazyLock::new(|| cf_site_sdk::bundle_script("x", TEMPLATE));

cf_site_sdk::export_site!(include_bytes!("../site.json"), SCRIPT.as_bytes());
