//! One screenshot of the Path of Exile 2 window, taken only when the user presses the inventory
//! screenshot shortcut (or picks a file). Never continuous, never in the background.
//!
//! Captures the game window's client area (not the whole desktop) through GDI: the composited image of
//! that rectangle on screen. Works for windowed and borderless ("windowed fullscreen") games on any
//! monitor; an exclusive-fullscreen game may come back black, which is detected and reported. No process
//! memory access, no injection, no input — only public window-manager / GDI calls.

use super::image::Rgba;

#[cfg(windows)]
pub fn game_window() -> Result<Rgba, String> {
    use crate::game::GameId;
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetClientRect, GetForegroundWindow, GetWindowTextW, IsIconic};

    let hwnd = unsafe { GetForegroundWindow() };
    let read = |f: &dyn Fn(&mut [u16]) -> i32| {
        let mut buf = [0u16; 256];
        let n = f(&mut buf).max(0) as usize;
        String::from_utf16_lossy(&buf[..n.min(buf.len())])
    };
    let class = read(&|b| unsafe { GetClassNameW(hwnd, b) });
    let title = read(&|b| unsafe { GetWindowTextW(hwnd, b) });
    if crate::overlay::win::classify(&class, &title) != Some(GameId::Poe2) {
        return Err("Path of Exile 2 isn't the active window. Switch to the game, open your inventory and press the shortcut again.".into());
    }
    if unsafe { IsIconic(hwnd) }.as_bool() {
        return Err("The game window is minimised.".into());
    }
    let mut rc = RECT::default();
    unsafe { GetClientRect(hwnd, &mut rc) }.map_err(|e| format!("Couldn't read the game window size: {e}"))?;
    let (w, h) = ((rc.right - rc.left) as i32, (rc.bottom - rc.top) as i32);
    if w < 640 || h < 360 {
        return Err("The game window is too small to read the inventory.".into());
    }
    let mut origin = POINT { x: 0, y: 0 };
    let _ = unsafe { ClientToScreen(hwnd, &mut origin) };

    // SAFETY: plain GDI calls on handles created and released here.
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("Couldn't access the screen.".into());
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp.into());
        let ok = BitBlt(mem, 0, 0, w, h, Some(screen), origin.x, origin.y, SRCCOPY | CAPTUREBLT).is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        let lines = if ok { GetDIBits(mem, bmp, 0, h as u32, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS) } else { 0 };
        SelectObject(mem, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if lines != h {
            return Err("Windows didn't return the game image.".into());
        }
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }
        let img = Rgba::from_raw(w as usize, h as usize, bgra).ok_or("Unexpected image size.")?;
        if is_blank(&img) {
            return Err("The screenshot came back black. Exclusive fullscreen can't be captured — switch Path of Exile 2 to “Windowed fullscreen”.".into());
        }
        Ok(img)
    }
}

#[cfg(not(windows))]
pub fn game_window() -> Result<Rgba, String> {
    Err("Inventory screenshots are only supported on Windows.".into())
}

/// Almost every sampled pixel black (exclusive fullscreen / protected content).
pub fn is_blank(img: &Rgba) -> bool {
    let mut lit = 0;
    let mut n = 0;
    for y in (0..img.h).step_by(17) {
        for x in (0..img.w).step_by(23) {
            n += 1;
            if img.luma(x, y) > 8.0 {
                lit += 1;
            }
        }
    }
    n > 0 && lit * 100 < n
}

#[cfg(test)]
mod tests {
    #[test]
    fn black_frames_are_detected() {
        let black = super::Rgba::new(800, 450);
        assert!(super::is_blank(&black));
        let img = super::super::image::load_fixture("poe2-2560x1440-scaled-2000.webp");
        assert!(!super::is_blank(&img));
    }
}
