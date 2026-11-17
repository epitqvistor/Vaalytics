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
    DispatchMessageW, GetClassNameW, GetCursorPos, GetForegroundWindow, GetMessageW, GetWindowTextW, TranslateMessage,
    EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT,
};

/// Window class used by both Path of Exile clients.
const POE_CLASS: &str = "POEWindowClass";

type Listener = Box<dyn Fn(Option<GameId>) + Send + Sync>;
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

fn game_of(hwnd: HWND) -> Option<GameId> {
    if hwnd.is_invalid() {
        return None;
    }
    let class = read_wide(|b| unsafe { GetClassNameW(hwnd, b) });
    let title = read_wide(|b| unsafe { GetWindowTextW(hwnd, b) });
    classify(&class, &title)
}

pub fn foreground_game() -> Option<GameId> {
    game_of(unsafe { GetForegroundWindow() })
}

unsafe extern "system" fn on_foreground(_: HWINEVENTHOOK, _: u32, hwnd: HWND, _: i32, _: i32, _: u32, _: u32) {
    if let Some(l) = LISTENER.get() {
        l(game_of(hwnd));
    }
}

/// Starts event-driven foreground tracking on a dedicated thread (no polling).
pub fn watch_foreground(listener: impl Fn(Option<GameId>) + Send + Sync + 'static) {
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
                l(foreground_game());
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
