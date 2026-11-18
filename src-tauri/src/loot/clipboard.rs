//! Clipboard change notifications (Windows), event-driven and scoped to the game.
//!
//! A hidden message-only window receives `WM_CLIPBOARDUPDATE`, but it is
//! registered as a clipboard listener ONLY while a Path of Exile 2 window is in
//! the foreground and capture is enabled (`AddClipboardFormatListener` /
//! `RemoveClipboardFormatListener`, switched by the existing foreground hook).
//! Nothing polls; outside the game Windows doesn't even notify Vaalytics.
//! This module only signals that the clipboard changed — the text is read by
//! the capture worker, which discards anything that isn't an item copy.

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::mpsc::Sender;
    use std::sync::{Mutex, OnceLock};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::DataExchange::{AddClipboardFormatListener, RemoveClipboardFormatListener};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW, TranslateMessage, HWND_MESSAGE, MSG,
        WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_CLIPBOARDUPDATE, WNDCLASSW,
    };

    const WM_SET_LISTENING: u32 = WM_APP + 41;
    static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
    static SIGNAL: OnceLock<Mutex<Sender<()>>> = OnceLock::new();
    static LISTENING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            WM_CLIPBOARDUPDATE => {
                if let Some(tx) = SIGNAL.get().and_then(|m| m.lock().ok()) {
                    let _ = tx.send(());
                }
                LRESULT(0)
            }
            WM_SET_LISTENING => {
                let want = wparam.0 == 1;
                if want != LISTENING.load(Ordering::SeqCst) {
                    let ok = if want { AddClipboardFormatListener(hwnd).is_ok() } else { RemoveClipboardFormatListener(hwnd).is_ok() };
                    if ok {
                        LISTENING.store(want, Ordering::SeqCst);
                    } else {
                        log::warn!("clipboard listener {} failed", if want { "registration" } else { "removal" });
                    }
                }
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    /// Starts the hidden window on its own thread. Signals go to `tx`.
    pub fn start(tx: Sender<()>) {
        if SIGNAL.set(Mutex::new(tx)).is_err() {
            return;
        }
        let spawned = std::thread::Builder::new().name("vaalytics-clipboard".into()).spawn(|| unsafe {
            let class = WNDCLASSW { lpfnWndProc: Some(wndproc), lpszClassName: w!("VaalyticsLootClipboard"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                log::error!("clipboard listener: RegisterClassW failed; loot capture unavailable");
                return;
            }
            let hwnd = match CreateWindowExW(WINDOW_EX_STYLE(0), w!("VaalyticsLootClipboard"), w!(""), WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, None, None) {
                Ok(h) => h,
                Err(e) => {
                    log::error!("clipboard listener: window creation failed ({e}); loot capture unavailable");
                    return;
                }
            };
            HWND_RAW.store(hwnd.0 as isize, Ordering::SeqCst);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
        if let Err(e) = spawned {
            log::error!("clipboard listener thread failed to start: {e}");
        }
    }

    /// Registers or removes the clipboard listener (thread-safe; posted to the window's thread).
    pub fn set_listening(on: bool) {
        let raw = HWND_RAW.load(Ordering::SeqCst);
        if raw == 0 {
            return;
        }
        // SAFETY: posting a message to our own window handle; no pointers are passed.
        let _ = unsafe { PostMessageW(Some(HWND(raw as *mut core::ffi::c_void)), WM_SET_LISTENING, WPARAM(on as usize), LPARAM(0)) };
    }

    pub fn is_listening() -> bool {
        LISTENING.load(Ordering::SeqCst)
    }

    pub fn available() -> bool {
        HWND_RAW.load(Ordering::SeqCst) != 0
    }

    /// Reads the clipboard's text (only called right after a change while the game is focused).
    pub fn read_text() -> Result<Option<String>, String> {
        let mut cb = arboard::Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?;
        match cb.get_text() {
            Ok(t) => Ok(Some(t)),
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(e) => Err(format!("Clipboard couldn't be read: {e}")),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::mpsc::Sender;
    pub fn start(_tx: Sender<()>) {}
    pub fn set_listening(_on: bool) {}
    pub fn is_listening() -> bool {
        false
    }
    pub fn available() -> bool {
        false
    }
    pub fn read_text() -> Result<Option<String>, String> {
        Err("Loot capture is only supported on Windows.".into())
    }
}

pub use imp::{available, is_listening, read_text, set_listening, start};
