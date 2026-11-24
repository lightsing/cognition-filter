//! Native plugin built in a temporary directory by the host integration test.
#[path = "../sdk/src/lib.rs"]
mod sdk;
#[cfg(not(plugin_v2))]
export_site!(
    br#"{"id":"fixture","name":"Example feed","version":"1.0"}"#,
    b"// ==UserScript==\n// @name Fixture\n// @version 1.0\n// @match https://example.test/*\n// ==/UserScript==\n(() => { /* @cognition-client-v1 */ })();"
);

#[cfg(plugin_v2)]
export_site!(
    br#"{"id":"fixture","name":"Example feed","version":"2.0","scheduling":{"coverConcurrency":7,"browserConcurrency":3}}"#,
    b"// ==UserScript==\n// @name Fixture\n// @version 2.0\n// @match https://example.test/*\n// ==/UserScript==\n(() => { /* @cognition-client-v1 */ })();"
);
