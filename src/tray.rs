//! Native Windows notification icon for the local agent.

use eyre::{Result, WrapErr, ensure};
use std::{
    collections::BTreeMap,
    io,
    ptr::{null, null_mut},
    sync::{Arc, Mutex, mpsc},
    thread::{self, JoinHandle},
};
use tokio::sync::oneshot;
use windows_sys::{
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            Com::{
                COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
            },
            LibraryLoader::GetModuleHandleW,
        },
        UI::{
            Shell::{
                NIF_ICON, NIF_INFO, NIF_MESSAGE, NIF_SHOWTIP, NIF_TIP, NIIF_INFO, NIM_ADD,
                NIM_DELETE, NIM_MODIFY, NIM_SETFOCUS, NIM_SETVERSION, NIN_BALLOONUSERCLICK,
                NIN_SELECT, NINF_KEY, NOTIFYICON_VERSION_4, NOTIFYICONDATAW, Shell_NotifyIconW,
                ShellExecuteW,
            },
            WindowsAndMessaging::*,
        },
    },
    core::{PCWSTR, w},
};

const CLASS_NAME: PCWSTR = w!("CognitionFilter.Tray");
const TITLE: PCWSTR = w!("Cognition Filter");
const CALLBACK: u32 = WM_APP + 1;
const KEY_SELECT: u32 = NIN_SELECT | NINF_KEY;
const RETRY_TIMER: usize = 1;
const EDIT: i32 = 1;
const PAIR: i32 = 2;
const EXIT: i32 = 3;
const STATS: i32 = 4;
const PNG: &[u8] = include_bytes!("../assets/cognition-filter-tray.png");

// CreateIconFromResourceEx requires a DWORD-aligned RT_ICON. Modern Windows accepts PNG.
#[repr(align(4))]
struct AlignedPng([u8; PNG.len()]);
static ICON: AlignedPng = AlignedPng(*include_bytes!("../assets/cognition-filter-tray.png"));

/// Display a short, caller-sanitized startup error even when running without a console.
pub(crate) fn show_error(message: &str) {
    let text: Vec<_> = message.encode_utf16().chain([0]).collect();
    unsafe { MessageBoxW(null_mut(), text.as_ptr(), TITLE, MB_OK | MB_ICONERROR) };
}

/// Keeps the Win32 message pump alive until the server finishes shutting down.
#[derive(Debug)]
pub(crate) struct Tray {
    window: Arc<Mutex<Option<isize>>>,
    thread: Option<JoinHandle<()>>,
}

/// Shared with the authenticated rules route for scripts that predate browser update prompts.
#[derive(Clone, Debug)]
pub(crate) struct UpdateNotice {
    window: Arc<Mutex<Option<isize>>>,
    shown: Arc<Mutex<BTreeMap<String, String>>>,
}

fn version_parts(value: &str) -> Option<Vec<u64>> {
    if value.len() >= 20 {
        return None;
    }
    let mut parts: Vec<_> = value
        .split('.')
        .map(|part| {
            if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            part.parse::<u64>().ok()
        })
        .collect::<Option<_>>()?;
    while parts.last() == Some(&0) {
        parts.pop();
    }
    Some(parts)
}

impl UpdateNotice {
    pub(crate) fn for_legacy_script(&self, site: &str, name: &str, installed: &str, latest: &str) {
        let (Some(old), Some(new)) = (version_parts(installed), version_parts(latest)) else {
            return;
        };
        if old >= new {
            return;
        }
        let mut shown = self.shown.lock().expect("tray notices");
        if shown.get(site).is_some_and(|version| version == latest) {
            return;
        }
        let window = self.window.lock().expect("tray handle");
        let Some(hwnd) = *window else { return };
        let mut title = [0u16; 64];
        let mut message = [0u16; 256];
        for (dst, src) in title
            .iter_mut()
            .zip("Cognition Filter · 油猴脚本有更新".encode_utf16())
        {
            *dst = src;
        }
        let text = format!(
            "{name}（{installed} → {latest}）。点击打开本机配对页，选择该站点的「安装或更新脚本」。"
        );
        for (dst, src) in message[..255].iter_mut().zip(text.encode_utf16()) {
            *dst = src;
        }
        let data = NOTIFYICONDATAW {
            cbSize: size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd as HWND,
            uID: 1,
            uFlags: NIF_INFO,
            dwInfoFlags: NIIF_INFO,
            szInfoTitle: title,
            szInfo: message,
            ..Default::default()
        };
        // Window teardown uses the same lock before destroying the handle.
        if unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) } != 0 {
            shown.insert(site.to_owned(), latest.to_owned());
        }
    }
}

impl Tray {
    pub(crate) fn update_notice(&self) -> UpdateNotice {
        UpdateNotice {
            window: Arc::clone(&self.window),
            shown: Arc::default(),
        }
    }
    pub(crate) fn start(exit: oneshot::Sender<()>, port: u16) -> Result<Self> {
        let window = Arc::new(Mutex::new(None));
        let shared = Arc::clone(&window);
        let (ready, started) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("notification-area".into())
            .spawn(move || {
                match Window::new(port) {
                    Ok(owner) => {
                        *shared.lock().expect("tray handle") = Some(owner.hwnd as isize);
                        if ready.send(Ok(())).is_ok() {
                            owner.dispatch();
                        }
                        // Prevent posting to a handle that Windows could recycle after destruction.
                        *shared.lock().expect("tray handle") = None;
                        drop(owner);
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error));
                    }
                }
                let _ = exit.send(());
            })
            .wrap_err("无法启动托盘线程")?;
        started.recv().wrap_err("托盘线程启动中断")??;
        Ok(Self {
            window,
            thread: Some(thread),
        })
    }
}

impl Drop for Tray {
    fn drop(&mut self) {
        if let Some(hwnd) = *self.window.lock().expect("tray handle") {
            unsafe { PostMessageW(hwnd as HWND, WM_CLOSE, 0, 0) };
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Window {
    port: u16,
    instance: HINSTANCE,
    class: u16,
    hwnd: HWND,
    icon: HICON,
    taskbar_created: u32,
    com: bool,
}

impl Window {
    fn new(port: u16) -> Result<Box<Self>> {
        // All handles, the COM apartment, and the WndProc state are owned by this OS thread.
        unsafe {
            let instance = GetModuleHandleW(null());
            let mut owner = Box::new(Self {
                port,
                instance,
                class: 0,
                hwnd: null_mut(),
                icon: null_mut(),
                taskbar_created: RegisterWindowMessageW(w!("TaskbarCreated")),
                com: CoInitializeEx(
                    null(),
                    (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
                ) >= 0,
            });
            ensure!(
                !instance.is_null() && owner.taskbar_created != 0 && owner.com,
                "无法初始化 Windows 托盘"
            );
            owner.icon = CreateIconFromResourceEx(
                ICON.0.as_ptr(),
                ICON.0.len() as u32,
                1,
                0x30000,
                GetSystemMetrics(SM_CXSMICON),
                GetSystemMetrics(SM_CYSMICON),
                LR_DEFAULTCOLOR,
            );
            ensure!(!owner.icon.is_null(), "无法载入托盘图标");
            let class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                lpszClassName: CLASS_NAME,
                ..Default::default()
            };
            owner.class = RegisterClassW(&class);
            ensure!(
                owner.class != 0,
                "无法注册托盘窗口类 ({})",
                io::Error::last_os_error()
            );
            // A hidden top-level window receives the TaskbarCreated broadcast. HWND_MESSAGE does not.
            owner.hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW,
                CLASS_NAME,
                TITLE,
                WS_POPUP,
                0,
                0,
                0,
                0,
                null_mut(),
                null_mut(),
                instance,
                null(),
            );
            ensure!(
                !owner.hwnd.is_null(),
                "无法创建托盘窗口 ({})",
                io::Error::last_os_error()
            );
            let address = (&raw const *owner) as isize;
            SetWindowLongPtrW(owner.hwnd, GWLP_USERDATA, address);
            ensure!(
                GetWindowLongPtrW(owner.hwnd, GWLP_USERDATA) == address,
                "无法绑定托盘消息处理器"
            );
            owner.install_icon();
            Ok(owner)
        }
    }

    fn open_page(&self, path: &str) {
        let url = format!("http://127.0.0.1:{}/{path}", self.port);
        let wide: Vec<_> = url.encode_utf16().chain([0]).collect();
        unsafe {
            if ShellExecuteW(
                self.hwnd,
                w!("open"),
                wide.as_ptr(),
                null(),
                null(),
                SW_SHOWNORMAL,
            ) as isize
                <= 32
            {
                show_error(&format!("无法打开默认浏览器。请在浏览器中打开 {url}"));
            }
        }
    }

    fn data(&self) -> NOTIFYICONDATAW {
        let mut info = NOTIFYICONDATAW {
            cbSize: size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: self.hwnd,
            uID: 1,
            uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_SHOWTIP,
            hIcon: self.icon,
            uCallbackMessage: CALLBACK,
            ..Default::default()
        };
        let mut tip = [0u16; 128];
        for (dst, src) in tip
            .iter_mut()
            .zip("Cognition Filter · 双击修改配置".encode_utf16())
        {
            *dst = src;
        }
        info.szTip = tip;
        info
    }

    fn install_icon(&self) {
        let mut info = self.data();
        unsafe {
            if Shell_NotifyIconW(NIM_ADD, &info) != 0 || Shell_NotifyIconW(NIM_MODIFY, &info) != 0 {
                info.Anonymous.uVersion = NOTIFYICON_VERSION_4;
                Shell_NotifyIconW(NIM_SETVERSION, &info);
                KillTimer(self.hwnd, RETRY_TIMER);
            } else {
                // At logon Explorer can broadcast TaskbarCreated before its notification area is ready.
                SetTimer(self.hwnd, RETRY_TIMER, 2000, None);
            }
        }
    }

    fn dispatch(&self) {
        let mut msg = MSG::default();
        unsafe {
            loop {
                match GetMessageW(&mut msg, null_mut(), 0, 0) {
                    0 => break,
                    -1 => {
                        tracing::error!("Windows 托盘消息循环终止");
                        break;
                    }
                    _ => {
                        TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }
            }
        }
    }
}

impl Drop for Window {
    fn drop(&mut self) {
        unsafe {
            if !self.hwnd.is_null() {
                SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, 0);
                KillTimer(self.hwnd, RETRY_TIMER);
                Shell_NotifyIconW(NIM_DELETE, &self.data());
                DestroyWindow(self.hwnd);
            }
            if self.class != 0 {
                UnregisterClassW(CLASS_NAME, self.instance);
            }
            if !self.icon.is_null() {
                DestroyIcon(self.icon);
            }
            if self.com {
                CoUninitialize();
            }
        }
    }
}

fn popup(owner: &Window, x: i32, y: i32) {
    unsafe {
        let menu = CreatePopupMenu();
        if menu.is_null() {
            return;
        }
        AppendMenuW(menu, MF_STRING, STATS as usize, w!("过滤统计"));
        AppendMenuW(menu, MF_STRING, EDIT as usize, w!("修改配置"));
        AppendMenuW(menu, MF_STRING, PAIR as usize, w!("打开配对页"));
        AppendMenuW(menu, MF_SEPARATOR, 0, null());
        AppendMenuW(menu, MF_STRING, EXIT as usize, w!("退出"));
        SetForegroundWindow(owner.hwnd);
        let command = TrackPopupMenu(
            menu,
            TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
            x,
            y,
            0,
            owner.hwnd,
            null(),
        );
        DestroyMenu(menu);
        PostMessageW(owner.hwnd, WM_NULL, 0, 0);
        match command {
            STATS => owner.open_page("stats"),
            EDIT => owner.open_page("settings"),
            PAIR => owner.open_page(""),
            EXIT => {
                PostMessageW(owner.hwnd, WM_CLOSE, 0, 0);
            }
            _ => {
                Shell_NotifyIconW(NIM_SETFOCUS, &owner.data());
            }
        }
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        // The boxed Window outlives all dispatches and is unlinked before DestroyWindow.
        let owner = (GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Window).as_ref();
        if let Some(owner) = owner {
            match message {
                CALLBACK => {
                    let event = (lparam as u32) & 0xffff;
                    match event {
                        WM_CONTEXTMENU => popup(
                            owner,
                            i32::from(wparam as i16),
                            i32::from((wparam >> 16) as i16),
                        ),
                        NIN_BALLOONUSERCLICK => owner.open_page(""),
                        WM_LBUTTONDBLCLK | KEY_SELECT => owner.open_page("settings"),
                        _ => {}
                    }
                    return 0;
                }
                WM_TIMER if wparam == RETRY_TIMER => {
                    owner.install_icon();
                    return 0;
                }
                m if m == owner.taskbar_created => {
                    owner.install_icon();
                    return 0;
                }
                WM_CLOSE => {
                    EndMenu();
                    PostQuitMessage(0);
                    return 0;
                }
                _ => {}
            }
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn update_versions_order_components_and_reject_invalid_headers() {
        assert!(version_parts("0.10") > version_parts("0.9.9"));
        assert_eq!(version_parts("1.0.0"), version_parts("1"));
        for value in ["", "1..2", "1.+2", "new"] {
            assert_eq!(version_parts(value), None);
        }
    }

    use super::*;
    use std::time::Duration;
    use tokio::time::timeout;
    use windows_sys::Win32::{
        Foundation::RECT,
        UI::Shell::{NOTIFYICONIDENTIFIER, Shell_NotifyIconGetRect},
    };

    #[tokio::test]
    async fn tray_restarts_and_closes_without_a_visible_window() -> Result<()> {
        let (exit, closed) = oneshot::channel();
        let tray = Tray::start(exit, 56635)?;
        let hwnd = tray.window.lock().unwrap().unwrap() as HWND;
        unsafe {
            assert_eq!(IsWindowVisible(hwnd), 0);
            let ident = NOTIFYICONIDENTIFIER {
                cbSize: size_of::<NOTIFYICONIDENTIFIER>() as u32,
                hWnd: hwnd,
                uID: 1,
                ..Default::default()
            };
            // Explorer may be absent on CI. If it accepted our icon, remove it to simulate
            // Explorer losing its tray, then verify the native broadcast handler restores it.
            let mut rect = RECT::default();
            if Shell_NotifyIconGetRect(&ident, &mut rect) == 0 {
                let info = NOTIFYICONDATAW {
                    cbSize: size_of::<NOTIFYICONDATAW>() as u32,
                    hWnd: hwnd,
                    uID: 1,
                    ..Default::default()
                };
                assert_ne!(Shell_NotifyIconW(NIM_DELETE, &info), 0);
                SendMessageW(hwnd, RegisterWindowMessageW(w!("TaskbarCreated")), 0, 0);
                assert_eq!(Shell_NotifyIconGetRect(&ident, &mut rect), 0);
                tracing::info!("已验证 Windows 通知区图标注册和恢复");
            }
            assert_ne!(PostMessageW(hwnd, WM_CLOSE, 0, 0), 0);
        }
        timeout(Duration::from_secs(5), closed).await??;
        drop(tray);
        assert_eq!(unsafe { IsWindow(hwnd) }, 0);
        Ok(())
    }
}
