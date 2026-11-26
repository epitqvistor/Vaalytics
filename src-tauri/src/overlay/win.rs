//! Windows-specific primitives: foreground-window tracking, key simulation,
//! cursor position. No process memory access, no injection — only public
//! window-manager APIs that any desktop app may use.

use crate::game::GameId;
use std::sync::OnceLock;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_C,
    VK_CONTROL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetMessageW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    IsWindow, SetForegroundWindow, TranslateMessage, EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT,
};

/// Window class used by both Path of Exile clients.
const POE_CLASS: &str = "POEWindowClass";

/// Called with the foreground game (if any) and whether the foreground window belongs to Vaalytics itself.
type Listener = Box<dyn Fn(Option<GameId>, bool) + Send + Sync>;
static LISTENER: OnceLock<Listener> = OnceLock::new();

fn read_wide(f: impl FnOnce(&mut [u16]) -> i32) -> String {
    let mut buf = [0u16; 256];
    let n = f(&mut buf).max(0) as usize;
    String::from_utf16_lossy(&buf[..n.min(buf.len())])
}

/// Identifies the game from a window's class and exact title.
pub fn classify(class: &str, title: &str) -> Option<GameId> {
    if class != POE_CLASS {
        return None;
    }
    match title.trim() {
        "Path of Exile 2" => Some(GameId::Poe2),
        "Path of Exile" => Some(GameId::Poe1),
        _ => None,
    }
}

fn is_own(hwnd: HWND) -> bool {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid != 0 && pid == std::process::id()
}

fn game_of(hwnd: HWND) -> Option<GameId> {
    // Never read the title of our own windows (WM_GETTEXT to our own UI thread can deadlock, see below),
    // and only read titles of windows with the game's class.
    if hwnd.is_invalid() || is_own(hwnd) {
        return None;
    }
    let class = read_wide(|b| unsafe { GetClassNameW(hwnd, b) });
    if class != POE_CLASS {
        return None;
    }
    let title = read_wide(|b| unsafe { GetWindowTextW(hwnd, b) });
    classify(&class, &title)
}

pub fn foreground_game() -> Option<GameId> {
    game_of(unsafe { GetForegroundWindow() })
}

/// Whether a Vaalytics window (main, overlays, dialogs) is the foreground window.
pub fn foreground_is_own() -> bool {
    let hwnd = unsafe { GetForegroundWindow() };
    !hwnd.is_invalid() && is_own(hwnd)
}

pub fn foreground_window() -> isize {
    unsafe { GetForegroundWindow() }.0 as isize
}

/// The foreground window when it is a Path of Exile window (raw handle, for giving focus back later).
pub fn foreground_game_window() -> Option<isize> {
    let hwnd = unsafe { GetForegroundWindow() };
    game_of(hwnd).map(|_| hwnd.0 as isize)
}

/// Whether `raw` still is a live Path of Exile window.
pub fn is_game_window(raw: isize) -> bool {
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    unsafe { IsWindow(Some(hwnd)) }.as_bool() && game_of(hwnd).is_some()
}

/// Screen rectangle (left, top, right, bottom) of a window.
pub fn window_rect(raw: isize) -> Option<(i32, i32, i32, i32)> {
    let mut r = windows::Win32::Foundation::RECT::default();
    unsafe { GetWindowRect(HWND(raw as *mut core::ffi::c_void), &mut r) }.ok().map(|_| (r.left, r.top, r.right, r.bottom))
}

/// Plain `SetForegroundWindow` — window management only. Deliberately NOT tao's `set_focus`, whose fallback
/// injects a fake Alt key press into whatever has focus (the game). Works when this process is allowed to set
/// the foreground: it just received the hotkey, or it is the foreground process itself.
pub fn set_foreground(raw: isize) -> bool {
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    if unsafe { SetForegroundWindow(hwnd) }.as_bool() {
        return true;
    }
    // Windows can refuse (foreground lock). Fallback without sending any input: briefly share the input
    // state of the current foreground window's thread (AttachThreadInput), which makes the call allowed,
    // then detach. Only used for our own window coming to the front / handing focus back.
    unsafe {
        use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        let fg = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg, None);
        let me = GetCurrentThreadId();
        if fg_thread == 0 || fg_thread == me {
            return false;
        }
        let attached = AttachThreadInput(me, fg_thread, true).as_bool();
        let ok = SetForegroundWindow(hwnd).as_bool();
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
        ok
    }
}

unsafe extern "system" fn collect_game_window(hwnd: HWND, lparam: windows::Win32::Foundation::LPARAM) -> windows::core::BOOL {
    // Never query our own windows: GetWindowTextW on a window of this process
    // sends WM_GETTEXT to its thread, which deadlocks if that thread is waiting
    // on us. Other processes' titles are read from the window manager's cache.
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 || pid == std::process::id() {
        return windows::core::BOOL(1);
    }
    // Class first; the title is read only for Path of Exile windows.
    if read_wide(|b| GetClassNameW(hwnd, b)) == POE_CLASS {
        if let Some(game) = classify(POE_CLASS, &read_wide(|b| GetWindowTextW(hwnd, b))) {
            let out = &mut *(lparam.0 as *mut Vec<(u32, GameId)>);
            out.push((pid, game));
        }
    }
    windows::core::BOOL(1)
}

/// Process ids that own a top-level Path of Exile window, with the game the
/// window title identifies. Public window-manager API only; used by Session
/// Intelligence to tell PoE 1 from PoE 2 (both ship the same executable names).
pub fn game_window_pids() -> Vec<(u32, GameId)> {
    let mut out: Vec<(u32, GameId)> = Vec::new();
    // SAFETY: the callback only runs during EnumWindows and the pointer outlives it.
    let _ = unsafe { EnumWindows(Some(collect_game_window), windows::Win32::Foundation::LPARAM(&mut out as *mut _ as isize)) };
    out
}

unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, hwnd: HWND, _: i32, _: i32, _: u32, _: u32) {
    if let Some(l) = LISTENER.get() {
        let own = !hwnd.is_invalid() && is_own(hwnd);
        l(if own { None } else { game_of(hwnd) }, own);
    }
}

/// Starts event-driven foreground tracking on a dedicated thread (no polling).
pub fn watch_foreground(listener: impl Fn(Option<GameId>, bool) + Send + Sync + 'static) {
    if LISTENER.set(Box::new(listener)).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("vaalytics-foreground".into())
        .spawn(|| unsafe {
            let hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT);
            if hook.is_invalid() {
                log::error!("SetWinEventHook failed; price-check hotkey will not activate");
                return;
            }
            if let Some(l) = LISTENER.get() {
                l(foreground_game(), foreground_is_own());
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("spawn foreground thread");
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 },
        },
    }
}

fn is_down(vk: VIRTUAL_KEY) -> bool {
    (unsafe { GetAsyncKeyState(vk.0 as i32) } as u16 & 0x8000) != 0
}

/// Sends the game's copy shortcut. Ctrl is only pressed if the user is not
/// already holding it (they usually are, from Ctrl+D). Since PoE 3.29 Ctrl+C
/// copies the advanced description format.
pub fn send_copy() -> bool {
    let ctrl_held = is_down(VK_CONTROL);
    let mut seq = Vec::with_capacity(4);
    if !ctrl_held {
        seq.push(key(VK_CONTROL, false));
    }
    seq.push(key(VK_C, false));
    seq.push(key(VK_C, true));
    if !ctrl_held {
        seq.push(key(VK_CONTROL, true));
    }
    let sent = unsafe { SendInput(&seq, std::mem::size_of::<INPUT>() as i32) };
    sent as usize == seq.len()
}

pub fn cursor_position() -> Option<(i32, i32)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok().map(|_| (p.x, p.y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_only_exact_game_windows() {
        assert_eq!(classify("POEWindowClass", "Path of Exile"), Some(GameId::Poe1));
        assert_eq!(classify("POEWindowClass", "Path of Exile 2"), Some(GameId::Poe2));
        assert_eq!(classify("Chrome_WidgetWin_1", "Path of Exile"), None, "a browser tab titled like the game");
        assert_eq!(classify("POEWindowClass", "Something else"), None);
    }
}
