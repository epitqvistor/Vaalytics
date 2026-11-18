//! Converts the log's local wall-clock time to a Unix timestamp using the
//! system time zone rules for that date (DST-aware on Windows).

use super::log_format::LocalStamp;

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The stamp read as if it were UTC.
#[cfg_attr(windows, allow(dead_code))]
pub fn as_utc(s: LocalStamp) -> i64 {
    days_from_civil(s.year as i64, s.month as i64, s.day as i64) * 86_400 + s.hour as i64 * 3600 + s.minute as i64 * 60 + s.second as i64
}

/// Local → Unix seconds with the system's time zone.
#[cfg(windows)]
pub fn local_to_unix(s: LocalStamp) -> Option<i64> {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::Time::TzSpecificLocalTimeToSystemTime;
    let local = SYSTEMTIME {
        wYear: s.year,
        wMonth: s.month as u16,
        wDayOfWeek: 0,
        wDay: s.day as u16,
        wHour: s.hour as u16,
        wMinute: s.minute as u16,
        wSecond: s.second.min(59) as u16,
        wMilliseconds: 0,
    };
    let mut utc = SYSTEMTIME::default();
    // SAFETY: both pointers reference valid stack SYSTEMTIME values for the call.
    unsafe { TzSpecificLocalTimeToSystemTime(None, &local, &mut utc) }.ok()?;
    Some(
        days_from_civil(utc.wYear as i64, utc.wMonth as i64, utc.wDay as i64) * 86_400
            + utc.wHour as i64 * 3600
            + utc.wMinute as i64 * 60
            + utc.wSecond as i64,
    )
}

#[cfg(not(windows))]
pub fn local_to_unix(s: LocalStamp) -> Option<i64> {
    Some(as_utc(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        let s = LocalStamp { year: 2026, month: 11, day: 17, hour: 14, minute: 7, second: 45 };
        assert_eq!(as_utc(s), 1_794_924_465);
    }

    #[test]
    fn system_conversion_is_within_a_day_of_utc() {
        let s = LocalStamp { year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 };
        let v = local_to_unix(s).unwrap();
        assert!((v - as_utc(s)).abs() <= 14 * 3600);
    }
}
