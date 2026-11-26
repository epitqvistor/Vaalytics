//! Text recognition with Windows' built-in OCR engine (Windows.Media.Ocr, part of Windows 10/11).
//! Local only: no download, no cloud service, no extra dependency beyond the `windows` crate that
//! Vaalytics already uses. Runs once per screenshot on a worker thread.
//!
//! Ground labels are light text on a dark box. The image is turned into dark-on-light grey (inverted
//! brightest channel), upscaled when the text is small, and scaled down to the engine's maximum
//! dimension when larger.

use crate::loot::inventory::image::Rgba;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn union(&self, o: &Rect) -> Rect {
        let x0 = self.x.min(o.x);
        let y0 = self.y.min(o.y);
        let x1 = (self.x + self.w).max(o.x + o.w);
        let y1 = (self.y + self.h).max(o.y + o.h);
        Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
    /// Intersection over union, 0–1.
    pub fn iou(&self, o: &Rect) -> f64 {
        let ix = ((self.x + self.w).min(o.x + o.w) - self.x.max(o.x)).max(0.0);
        let iy = ((self.y + self.h).min(o.y + o.h) - self.y.max(o.y)).max(0.0);
        let inter = ix * iy;
        let uni = self.w * self.h + o.w * o.h - inter;
        if uni <= 0.0 {
            0.0
        } else {
            inter / uni
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    pub text: String,
    /// In the coordinates of the image given to `recognize`.
    pub rect: Rect,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub words: Vec<Word>,
}

/// How a screenshot is turned into grey for OCR. Loot filters style card labels differently, and no
/// single conversion gives every style good contrast, so both are read and the results merged:
/// - `MaxInverted`: 255 − brightest channel. Light text on dark boxes (default labels) and dark text on
///   saturated boxes (e.g. dark text on blue) become dark-on-light.
/// - `Luma`: perceived brightness. Coloured text on a white box (e.g. blue on white) stays dark-on-light —
///   with the brightest channel, blue text and the white box would both be bright.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    MaxInverted,
    Luma,
}

pub const VARIANTS: [Variant; 2] = [Variant::MaxInverted, Variant::Luma];

#[inline]
fn grey(variant: Variant, r: u8, g: u8, b: u8) -> u8 {
    match variant {
        Variant::MaxInverted => 255 - r.max(g).max(b),
        Variant::Luma => ((299 * r as u32 + 587 * g as u32 + 114 * b as u32) / 1000) as u8,
    }
}

/// Grey, dark-on-light version of `img` (max channel, inverted), as BGRA8.
pub fn prepare(img: &Rgba, scale: f64) -> (usize, usize, Vec<u8>) {
    prepare_as(img, scale, Variant::MaxInverted)
}

/// Grey version of `img` for one `Variant`, scaled, as BGRA8.
pub fn prepare_as(img: &Rgba, scale: f64, variant: Variant) -> (usize, usize, Vec<u8>) {
    let w = ((img.w as f64 * scale).round() as usize).max(1);
    let h = ((img.h as f64 * scale).round() as usize).max(1);
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let sy = ((y as f64 + 0.5) / scale) as usize;
        let sy = sy.min(img.h - 1);
        for x in 0..w {
            let sx = (((x as f64 + 0.5) / scale) as usize).min(img.w - 1);
            let [r, g, b, _] = img.get(sx, sy);
            let v = grey(variant, r, g, b);
            let i = (y * w + x) * 4;
            out[i] = v;
            out[i + 1] = v;
            out[i + 2] = v;
            out[i + 3] = 255;
        }
    }
    (w, h, out)
}

/// Scale that keeps the longest side within `max_dim` and upscales small captures (text height
/// matters more than pixels: the engine reads poorly below ~20 px letters).
pub fn scale_for(w: usize, h: usize, max_dim: u32) -> f64 {
    let longest = w.max(h) as f64;
    let max_dim = max_dim.max(800) as f64;
    let up = if longest * 2.0 <= max_dim { 2.0 } else { 1.0 };
    (max_dim / longest).min(up)
}

#[cfg(windows)]
pub fn recognize(img: &Rgba) -> Result<Vec<Line>, String> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let err = |what: &str, e: windows::core::Error| format!("{what}: {}", e.message());
    // English first (item names are English); the profile language reads Latin text too.
    let engine = Language::CreateLanguage(&HSTRING::from("en-US"))
        .ok()
        .filter(|l| OcrEngine::IsLanguageSupported(l).unwrap_or(false))
        .and_then(|l| OcrEngine::TryCreateFromLanguage(&l).ok())
        .or_else(|| OcrEngine::TryCreateFromUserProfileLanguages().ok())
        .ok_or("Windows text recognition (OCR) isn't available. Install an English language pack with OCR in Windows Settings → Time & language.")?;
    let max_dim = OcrEngine::MaxImageDimension().unwrap_or(2600);
    let scale = scale_for(img.w, img.h, max_dim);
    let mut lines = Vec::new();
    // One pass per grey conversion; `recognize::recognize` merges reads of the same label.
    for variant in VARIANTS {
        let (w, h, bgra) = prepare_as(img, scale, variant);
        let writer = DataWriter::new().map_err(|e| err("OCR buffer", e))?;
        writer.WriteBytes(&bgra).map_err(|e| err("OCR buffer", e))?;
        let buffer = writer.DetachBuffer().map_err(|e| err("OCR buffer", e))?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32).map_err(|e| err("OCR bitmap", e))?;
        let result = engine.RecognizeAsync(&bitmap).map_err(|e| err("OCR", e))?.join().map_err(|e| err("OCR", e))?;
        for line in result.Lines().map_err(|e| err("OCR result", e))? {
            let mut words = Vec::new();
            for word in line.Words().map_err(|e| err("OCR result", e))? {
                let text = word.Text().map(|t| t.to_string_lossy()).unwrap_or_default();
                let r = word.BoundingRect().map_err(|e| err("OCR result", e))?;
                words.push(Word { text, rect: Rect { x: r.X as f64 / scale, y: r.Y as f64 / scale, w: r.Width as f64 / scale, h: r.Height as f64 / scale } });
            }
            if !words.is_empty() {
                lines.push(Line { words });
            }
        }
    }
    Ok(lines)
}

#[cfg(not(windows))]
pub fn recognize(_img: &Rgba) -> Result<Vec<Line>, String> {
    Err("Text recognition is only available on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepare_inverts_and_scales() {
        let mut img = Rgba::new(2, 1);
        img.put(0, 0, [14, 186, 255, 255]); // card-label blue
        img.put(1, 0, [0, 0, 0, 255]);
        let (w, h, px) = prepare(&img, 2.0);
        assert_eq!((w, h), (4, 2));
        assert_eq!(px[0], 0, "bright text becomes dark");
        assert_eq!(px[8], 255, "dark background becomes light");
    }

    #[test]
    fn variants_give_contrast_for_both_label_styles() {
        let mut img = Rgba::new(2, 1);
        img.put(0, 0, [25, 40, 210, 255]); // blue text
        img.put(1, 0, [255, 255, 255, 255]); // white box
        let (_, _, max) = prepare_as(&img, 1.0, Variant::MaxInverted);
        let (_, _, luma) = prepare_as(&img, 1.0, Variant::Luma);
        let contrast = |px: &[u8]| (px[0] as i32 - px[4] as i32).abs();
        assert!(contrast(&max) < 60, "max channel: blue text ≈ white box");
        assert!(contrast(&luma) > 150, "luma separates blue text from white");
        assert!(luma[0] < luma[4], "dark text on light");
    }

    #[test]
    fn scale_limits() {
        assert_eq!(scale_for(1000, 500, 2600), 2.0);
        assert_eq!(scale_for(2560, 1440, 2600), 1.0);
        assert!(scale_for(3840, 2160, 2600) < 1.0);
    }

    #[test]
    fn rect_math() {
        let a = Rect { x: 0.0, y: 0.0, w: 10.0, h: 10.0 };
        let b = Rect { x: 5.0, y: 0.0, w: 10.0, h: 10.0 };
        assert!((a.iou(&b) - 50.0 / 150.0).abs() < 1e-9);
        assert_eq!(a.union(&b), Rect { x: 0.0, y: 0.0, w: 15.0, h: 10.0 });
        assert_eq!(b.center(), (10.0, 5.0));
    }

    /// Real OCR smoke test: `DECK_OCR_IMAGE=<png>` prints what Windows reads.
    #[test]
    #[ignore]
    fn ocr_image_from_env() {
        let path = std::env::var("DECK_OCR_IMAGE").expect("DECK_OCR_IMAGE");
        let img = Rgba::from_png(&std::fs::read(path).unwrap()).unwrap();
        for l in recognize(&img).unwrap() {
            println!("{:?}", l.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>());
        }
    }
}
