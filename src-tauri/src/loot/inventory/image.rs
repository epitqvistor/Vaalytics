//! Minimal RGBA image used by inventory recognition (no image crate at runtime).

#[derive(Debug, Clone, PartialEq)]
pub struct Rgba {
    pub w: usize,
    pub h: usize,
    /// Row-major RGBA8.
    pub px: Vec<u8>,
}

impl Rgba {
    pub fn new(w: usize, h: usize) -> Self {
        Self { w, h, px: vec![0; w * h * 4] }
    }

    pub fn from_raw(w: usize, h: usize, px: Vec<u8>) -> Option<Self> {
        (px.len() == w * h * 4 && w > 0 && h > 0).then_some(Self { w, h, px })
    }

    #[inline]
    pub fn get(&self, x: usize, y: usize) -> [u8; 4] {
        let i = (y * self.w + x) * 4;
        [self.px[i], self.px[i + 1], self.px[i + 2], self.px[i + 3]]
    }

    #[inline]
    pub fn put(&mut self, x: usize, y: usize, c: [u8; 4]) {
        let i = (y * self.w + x) * 4;
        self.px[i..i + 4].copy_from_slice(&c);
    }

    /// Perceived brightness 0–255.
    #[inline]
    pub fn luma(&self, x: usize, y: usize) -> f32 {
        let [r, g, b, _] = self.get(x, y);
        0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32
    }

    /// Crop (clamped to the image).
    pub fn crop(&self, x: usize, y: usize, w: usize, h: usize) -> Rgba {
        let x = x.min(self.w.saturating_sub(1));
        let y = y.min(self.h.saturating_sub(1));
        let w = w.min(self.w - x).max(1);
        let h = h.min(self.h - y).max(1);
        let mut out = Rgba::new(w, h);
        for row in 0..h {
            let src = ((y + row) * self.w + x) * 4;
            let dst = row * w * 4;
            out.px[dst..dst + w * 4].copy_from_slice(&self.px[src..src + w * 4]);
        }
        out
    }

    /// Area-average resize (good for downscaling; bilinear-ish for upscaling).
    pub fn resize(&self, nw: usize, nh: usize) -> Rgba {
        let mut out = Rgba::new(nw.max(1), nh.max(1));
        let sx = self.w as f32 / out.w as f32;
        let sy = self.h as f32 / out.h as f32;
        for oy in 0..out.h {
            let y0 = oy as f32 * sy;
            let y1 = ((oy + 1) as f32 * sy).max(y0 + 1.0);
            for ox in 0..out.w {
                let x0 = ox as f32 * sx;
                let x1 = ((ox + 1) as f32 * sx).max(x0 + 1.0);
                let mut acc = [0f32; 4];
                let mut wsum = 0f32;
                let mut y = y0.floor() as usize;
                while (y as f32) < y1 && y < self.h {
                    let wy = (y1.min(y as f32 + 1.0) - y0.max(y as f32)).max(0.0);
                    let mut x = x0.floor() as usize;
                    while (x as f32) < x1 && x < self.w {
                        let wx = (x1.min(x as f32 + 1.0) - x0.max(x as f32)).max(0.0);
                        let wgt = wx * wy;
                        let p = self.get(x, y);
                        for k in 0..4 {
                            acc[k] += p[k] as f32 * wgt;
                        }
                        wsum += wgt;
                        x += 1;
                    }
                    y += 1;
                }
                let c = if wsum > 0.0 { acc.map(|v| (v / wsum).round().clamp(0.0, 255.0) as u8) } else { [0; 4] };
                out.put(ox, oy, c);
            }
        }
        out
    }

    /// Encodes as PNG (RGB, alpha dropped) — the stored inventory crop.
    pub fn to_png(&self) -> Result<Vec<u8>, String> {
        let mut rgb = Vec::with_capacity(self.w * self.h * 3);
        for c in self.px.chunks_exact(4) {
            rgb.extend_from_slice(&c[..3]);
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, self.w as u32, self.h as u32);
            enc.set_color(png::ColorType::Rgb);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().map_err(|e| e.to_string())?;
            wr.write_image_data(&rgb).map_err(|e| e.to_string())?;
        }
        Ok(out)
    }

    /// Decodes a PNG (any 8-bit colour type) into RGBA.
    pub fn from_png(bytes: &[u8]) -> Result<Rgba, String> {
        let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
        dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
        let mut reader = dec.read_info().map_err(|e| e.to_string())?;
        let mut buf = vec![0; reader.output_buffer_size().ok_or("PNG too large")?];
        let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
        let (w, h) = (info.width as usize, info.height as usize);
        let data = &buf[..info.buffer_size()];
        let px: Vec<u8> = match info.color_type {
            png::ColorType::Rgba => data.to_vec(),
            png::ColorType::Rgb => data.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
            png::ColorType::GrayscaleAlpha => data.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
            png::ColorType::Grayscale => data.iter().flat_map(|&g| [g, g, g, 255]).collect(),
            png::ColorType::Indexed => return Err("indexed PNG not expanded".into()),
        };
        Rgba::from_raw(w, h, px).ok_or_else(|| "PNG size mismatch".into())
    }
}

#[cfg(test)]
pub fn load_fixture(name: &str) -> Rgba {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/inventory").join(name);
    let img = image::open(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())).to_rgba8();
    Rgba::from_raw(img.width() as usize, img.height() as usize, img.into_raw()).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_resize_and_png_round_trip() {
        let mut img = Rgba::new(4, 2);
        img.put(0, 0, [255, 0, 0, 255]);
        img.put(3, 1, [0, 0, 255, 255]);
        let c = img.crop(2, 0, 10, 10);
        assert_eq!((c.w, c.h), (2, 2));
        assert_eq!(c.get(1, 1), [0, 0, 255, 255]);
        let r = img.resize(2, 1);
        assert_eq!((r.w, r.h), (2, 1));
        assert_eq!(r.get(0, 0)[0], 64, "averaged");
        let png = img.to_png().unwrap();
        let back = Rgba::from_png(&png).unwrap();
        assert_eq!((back.w, back.h, back.get(0, 0)), (4, 2, [255, 0, 0, 255]));
    }
}
