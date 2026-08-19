//! Remembers where the window was, in logical pixels.
//!
//! Two problems, one fix. The window opened at the configured 1240 × 820 in the
//! middle of the primary monitor every single launch, however the user had left
//! it; and nothing in the codebase touched `scale_factor`, so there was no
//! decision on record about what a saved coordinate would even mean at 125% or
//! 150% scaling.
//!
//! Everything here is therefore *logical*. A physical position saved on a 150%
//! monitor and restored on a 100% one lands two thirds of the way across the
//! screen — this is exactly the bug that makes people say an app "doesn't handle
//! DPI". Tauri's `LogicalPosition`/`LogicalSize` do the conversion at the edge,
//! and the stored numbers stay comparable across monitors and scale changes.
//!
//! The other half is that a remembered position must still be reachable. A
//! window last closed on a second monitor that is now unplugged, or on a screen
//! whose resolution shrank, would otherwise be restored off-screen with no way
//! to drag it back — worse than not remembering at all.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

/// The window's configured floor, mirrored from `tauri.conf.json`. A restored
/// size below this would fight the OS minimum and land somewhere arbitrary.
pub const MIN_WIDTH: f64 = 900.0;
pub const MIN_HEIGHT: f64 = 680.0;

/// How much of the window has to stay on a monitor for it to count as reachable.
/// Enough to grab the title bar and drag it back.
const MIN_VISIBLE_WIDTH: f64 = 120.0;
const MIN_VISIBLE_HEIGHT: f64 = 40.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

/// A monitor's usable area, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Whether enough of `state` lands on at least one of `monitors`.
pub fn is_reachable(state: &WindowState, monitors: &[Bounds]) -> bool {
    monitors.iter().any(|monitor| {
        let overlap_width =
            (state.x + state.width).min(monitor.x + monitor.width) - state.x.max(monitor.x);
        let overlap_height =
            (state.y + state.height).min(monitor.y + monitor.height) - state.y.max(monitor.y);
        overlap_width >= MIN_VISIBLE_WIDTH && overlap_height >= MIN_VISIBLE_HEIGHT
    })
}

/// The state to actually restore, or `None` to leave the configured default.
///
/// Sizes are clamped to the window minimum and to the monitor, and a window that
/// no longer overlaps any monitor is dropped rather than nudged: guessing where
/// the user "meant" it to be on a display layout that no longer exists produces
/// a worse answer than the default.
pub fn restorable(state: WindowState, monitors: &[Bounds]) -> Option<WindowState> {
    if monitors.is_empty() {
        return None;
    }
    if !state.width.is_finite()
        || !state.height.is_finite()
        || !state.x.is_finite()
        || !state.y.is_finite()
    {
        return None;
    }
    let widest = monitors.iter().fold(0.0_f64, |acc, m| acc.max(m.width));
    let tallest = monitors.iter().fold(0.0_f64, |acc, m| acc.max(m.height));
    let clamped = WindowState {
        width: state.width.clamp(MIN_WIDTH, widest.max(MIN_WIDTH)),
        height: state.height.clamp(MIN_HEIGHT, tallest.max(MIN_HEIGHT)),
        ..state
    };
    is_reachable(&clamped, monitors).then_some(clamped)
}

fn state_path(directory: &Path) -> std::path::PathBuf {
    directory.join("window-state.json")
}

/// Reads the saved state. A missing or malformed file is simply "no state" —
/// this is a convenience, never a reason to fail a launch.
pub fn load(directory: &Path) -> Option<WindowState> {
    let contents = fs::read_to_string(state_path(directory)).ok()?;
    serde_json::from_str(&contents).ok()
}

/// Writes the state, creating the directory if needed. Failures are ignored for
/// the same reason.
pub fn save(directory: &Path, state: &WindowState) {
    let _ = fs::create_dir_all(directory);
    if let Ok(serialized) = serde_json::to_string(state) {
        let _ = fs::write(state_path(directory), serialized);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: Bounds = Bounds {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1040.0,
    };
    const SECOND: Bounds = Bounds {
        x: 1920.0,
        y: 0.0,
        width: 1280.0,
        height: 1024.0,
    };

    fn state(x: f64, y: f64, width: f64, height: f64) -> WindowState {
        WindowState {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    #[test]
    fn restores_a_window_that_is_still_on_screen() {
        let saved = state(200.0, 120.0, 1240.0, 820.0);
        assert_eq!(restorable(saved, &[PRIMARY]), Some(saved));
    }

    #[test]
    fn restores_a_window_on_a_second_monitor() {
        let saved = state(2100.0, 80.0, 1100.0, 800.0);
        assert_eq!(restorable(saved, &[PRIMARY, SECOND]), Some(saved));
    }

    #[test]
    fn drops_a_window_whose_monitor_was_unplugged() {
        // The same position with only the primary monitor present is entirely
        // off-screen, and a restored window there cannot be dragged back.
        let saved = state(2100.0, 80.0, 1100.0, 800.0);
        assert_eq!(restorable(saved, &[PRIMARY]), None);
    }

    #[test]
    fn drops_a_window_left_just_off_the_edge() {
        // Only 40px of width would remain visible — not enough to grab.
        let saved = state(1880.0, 100.0, 1240.0, 820.0);
        assert!(!is_reachable(&saved, &[PRIMARY]));
        assert_eq!(restorable(saved, &[PRIMARY]), None);
    }

    #[test]
    fn keeps_a_window_hanging_off_the_bottom_but_still_grabbable() {
        let saved = state(300.0, 990.0, 1240.0, 820.0);
        assert_eq!(restorable(saved, &[PRIMARY]).map(|s| s.y), Some(990.0));
    }

    #[test]
    fn clamps_a_size_below_the_configured_minimum() {
        let restored =
            restorable(state(100.0, 100.0, 400.0, 300.0), &[PRIMARY]).expect("reachable");
        assert_eq!(restored.width, MIN_WIDTH);
        assert_eq!(restored.height, MIN_HEIGHT);
    }

    #[test]
    fn clamps_a_size_larger_than_every_monitor() {
        // What a 150% monitor's physical pixels would look like if they were
        // ever written here by mistake: far larger than any logical screen.
        let restored = restorable(state(0.0, 0.0, 5760.0, 3240.0), &[PRIMARY]).expect("reachable");
        assert_eq!(restored.width, PRIMARY.width);
        assert_eq!(restored.height, PRIMARY.height);
    }

    #[test]
    fn refuses_nonsense_and_a_headless_machine() {
        assert_eq!(
            restorable(state(f64::NAN, 0.0, 1000.0, 700.0), &[PRIMARY]),
            None
        );
        assert_eq!(
            restorable(state(0.0, 0.0, f64::INFINITY, 700.0), &[PRIMARY]),
            None
        );
        assert_eq!(restorable(state(0.0, 0.0, 1000.0, 700.0), &[]), None);
    }

    #[test]
    fn round_trips_through_disk_and_tolerates_a_corrupt_file() {
        let directory =
            std::env::temp_dir().join(format!("knitspace-window-state-{}", uuid::Uuid::now_v7()));
        assert_eq!(load(&directory), None);

        let saved = WindowState {
            x: 12.0,
            y: 34.0,
            width: 1000.0,
            height: 700.0,
            maximized: true,
        };
        save(&directory, &saved);
        assert_eq!(load(&directory), Some(saved));

        fs::write(state_path(&directory), "{ not json").expect("write corrupt file");
        assert_eq!(load(&directory), None);

        fs::remove_dir_all(directory).expect("clean test directory");
    }
}
