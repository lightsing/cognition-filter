//! Export a self-contained Cognition Filter site plugin using the v1 C ABI.

/// Browser client template for plugins that bundle their own client with the DLL.
pub const BROWSER_CLIENT: &str = include_str!("../client.js");

/// Embed the matching client so a hot-reloaded DLL can update older agent installations.
pub fn bundle_script(site: &str, template: &str) -> String {
    let version = template
        .lines()
        .find_map(|line| line.strip_prefix("// @version "))
        .expect("bundled userscript version")
        .trim();
    let client = BROWSER_CLIENT
        .replace("__CF_SITE_ID__", site)
        .replace("__CF_SITE_VERSION__", version);
    template.replace("/* @cognition-client-v1 */", &client)
}

/// Export a UTF-8 JSON manifest and a userscript template as borrowed, immutable resources.
#[macro_export]
macro_rules! export_site {
    ($manifest:expr, $script:expr) => {
        /// Return a static resource. Resource 0 is the manifest and 1 is the userscript.
        ///
        /// # Safety
        /// A non-null length pointer must be aligned and writable for one `usize`.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn cf_site_resource_v1(kind: u32, len: *mut usize) -> *const u8 {
            if len.is_null() {
                return ::core::ptr::null();
            }
            let resource: &'static [u8] = match kind {
                0 => $manifest,
                1 => $script,
                _ => &[],
            };
            // SAFETY: the host supplies a valid output pointer for this call.
            unsafe {
                len.write(resource.len());
            }
            if resource.is_empty() {
                ::core::ptr::null()
            } else {
                resource.as_ptr()
            }
        }
    };
}
