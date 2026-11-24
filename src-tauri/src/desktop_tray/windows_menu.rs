use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::null_mut;
use tauri::menu::{ContextMenu, IsMenuItem, Menu};
use windows::core::{w, PCWSTR};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::UI::HiDpi::{GetDpiForSystem, GetDpiForWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, SetMenuItemInfoW, HMENU, MENUITEMINFOW, MIIM_BITMAP,
};

const MENU_ICON_SIZE: u32 = 20;

fn menu_icon_size(dpi: u32) -> u32 {
    (MENU_ICON_SIZE * dpi.clamp(96, 288) + 48) / 96
}

fn taskbar_dpi() -> u32 {
    // The tray can be on a different monitor from the Studio workspace.
    let dpi = unsafe {
        FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null())
            .map(|taskbar| GetDpiForWindow(taskbar))
            .unwrap_or(0)
    };
    if dpi == 0 {
        unsafe { GetDpiForSystem() }
    } else {
        dpi
    }
}

// Win32 borrows the bitmap while the popup owns its menu items. The tray keeps
// these handles for its lifetime and never replaces them during menu display.
pub(super) struct MenuBitmap(isize);

impl MenuBitmap {
    fn attach(
        menu: HMENU,
        position: u32,
        image: &tauri::image::Image<'_>,
    ) -> windows::core::Result<Self> {
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: image.width() as i32,
                biHeight: -(image.height() as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buffer: *mut c_void = null_mut();
        // The 32-bit top-down DIB has no row padding. Win32 composites
        // premultiplied BGRA for native popup item bitmaps.
        let handle =
            unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut buffer, None, 0)? };
        let bitmap = Self(handle.0 as isize);
        let output =
            unsafe { std::slice::from_raw_parts_mut(buffer.cast::<u8>(), image.rgba().len()) };
        let (source, _) = image.rgba().as_chunks::<4>();
        let (destination, _) = output.as_chunks_mut::<4>();
        for (&[red, green, blue, alpha], bgra) in source.iter().zip(destination) {
            let premultiply = |color: u8| ((u16::from(color) * u16::from(alpha) + 127) / 255) as u8;
            *bgra = [
                premultiply(blue),
                premultiply(green),
                premultiply(red),
                alpha,
            ];
        }

        let item = MENUITEMINFOW {
            cbSize: size_of::<MENUITEMINFOW>() as u32,
            fMask: MIIM_BITMAP,
            hbmpItem: handle,
            ..Default::default()
        };
        unsafe { SetMenuItemInfoW(menu, position, true, &item)? };
        Ok(bitmap)
    }
}

impl Drop for MenuBitmap {
    fn drop(&mut self) {
        let _ = unsafe { DeleteObject(HGDIOBJ(self.0 as _)) };
    }
}

pub(super) fn install(
    menu: &Menu<tauri::Wry>,
    items: &[&dyn IsMenuItem<tauri::Wry>],
    icons: &[(&str, &[u8])],
) -> tauri::Result<Vec<MenuBitmap>> {
    // Muda 0.19.2 redraws supplied Windows menu icons into a fixed 16 px
    // bitmap. Attach our DPI-sized bitmaps to this popup only.
    let popup = HMENU(menu.hpopupmenu()? as _);
    let size = menu_icon_size(taskbar_dpi());
    let mut bitmaps = Vec::with_capacity(icons.len());
    for (position, item) in items.iter().enumerate() {
        let Some((_, asset)) = icons.iter().find(|(id, _)| *id == item.id().as_ref()) else {
            continue;
        };
        let Some(image) = super::menu_icon(asset, size) else {
            continue;
        };
        match MenuBitmap::attach(popup, position as u32, &image) {
            Ok(bitmap) => bitmaps.push(bitmap),
            Err(error) => log::warn!("[desktop-tray] could not attach popup icon: {error}"),
        }
    }
    Ok(bitmaps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::PWSTR;
    use windows::Win32::Graphics::Gdi::{GetObjectW, DIBSECTION, HBITMAP};
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, DestroyMenu, GetMenuItemInfoW, MF_STRING, MIIM_ID,
        MIIM_STRING,
    };

    #[test]
    fn tauri_popup_keeps_icons_when_labels_change() {
        use tauri::menu::{MenuItem, Submenu};

        let app = tauri::Builder::default()
            .any_thread()
            .build(crate::application_context::create())
            .unwrap();
        let tools =
            super::super::menu_action(&app, "tools-test", "打开工具中心", super::super::TOOLS_ICON)
                .unwrap();
        let exit = MenuItem::new(&app, "退出", true, None::<&str>).unwrap();
        let shortcuts = Submenu::new(&app, "快捷工具", true).unwrap();
        let items: [&dyn IsMenuItem<tauri::Wry>; 3] = [&tools, &exit, &shortcuts];
        let menu = Menu::with_items(&app, &items).unwrap();
        let popup = HMENU(menu.hpopupmenu().unwrap() as _);
        let bitmaps = install(
            &menu,
            &items,
            &[
                (tools.id().as_ref(), super::super::TOOLS_ICON),
                (shortcuts.id().as_ref(), super::super::FAVORITES_ICON),
            ],
        )
        .unwrap();
        assert_eq!(bitmaps.len(), 2);

        tools.set_text("Open tool center").unwrap();
        shortcuts.set_text("Quick tools").unwrap();
        for (position, expected) in [bitmaps[0].0, 0, bitmaps[1].0].into_iter().enumerate() {
            let mut item = MENUITEMINFOW {
                cbSize: size_of::<MENUITEMINFOW>() as u32,
                fMask: MIIM_BITMAP,
                ..Default::default()
            };
            unsafe { GetMenuItemInfoW(popup, position as u32, true, &mut item).unwrap() };
            assert_eq!(item.hbmpItem.0 as isize, expected);
        }
        drop(menu);
    }

    #[test]
    fn native_popup_bitmaps_keep_scaled_dimensions_and_localized_labels() {
        for (dpi, expected_size) in [(96, 20), (120, 25), (144, 30), (192, 40)] {
            let size = menu_icon_size(dpi);
            assert_eq!(size, expected_size);
            let menu = unsafe { CreatePopupMenu().unwrap() };
            unsafe { AppendMenuW(menu, MF_STRING, 42, w!("打开工具中心")).unwrap() };
            let image = tauri::image::Image::new_owned(
                [200, 100, 50, 128].repeat((size * size) as usize),
                size,
                size,
            );
            let bitmap = MenuBitmap::attach(menu, 0, &image).unwrap();

            let mut label = [0u16; 40];
            let mut item = MENUITEMINFOW {
                cbSize: size_of::<MENUITEMINFOW>() as u32,
                fMask: MIIM_BITMAP | MIIM_ID | MIIM_STRING,
                dwTypeData: PWSTR(label.as_mut_ptr()),
                cch: label.len() as u32,
                ..Default::default()
            };
            unsafe { GetMenuItemInfoW(menu, 0, true, &mut item).unwrap() };
            assert_eq!(
                String::from_utf16_lossy(&label[..item.cch as usize]),
                "打开工具中心"
            );
            assert_eq!(item.wID, 42);
            let mut dib = DIBSECTION::default();
            let bytes = unsafe {
                GetObjectW(
                    HGDIOBJ(item.hbmpItem.0),
                    size_of::<DIBSECTION>() as i32,
                    Some((&mut dib as *mut DIBSECTION).cast()),
                )
            };
            assert_eq!(bytes as usize, size_of::<DIBSECTION>());
            let native_bitmap = dib.dsBm;
            assert_eq!(
                (native_bitmap.bmWidth, native_bitmap.bmHeight),
                (size as i32, size as i32)
            );
            assert_eq!(native_bitmap.bmBitsPixel, 32);
            assert!(!native_bitmap.bmBits.is_null());
            let pixel = unsafe { std::slice::from_raw_parts(native_bitmap.bmBits.cast::<u8>(), 4) };
            assert_eq!(pixel, [25, 50, 100, 128]);

            let mut english: Vec<u16> = "Open tool center\0".encode_utf16().collect();
            let rename = MENUITEMINFOW {
                cbSize: size_of::<MENUITEMINFOW>() as u32,
                fMask: MIIM_STRING,
                dwTypeData: PWSTR(english.as_mut_ptr()),
                ..Default::default()
            };
            unsafe { SetMenuItemInfoW(menu, 0, true, &rename).unwrap() };
            item.cch = label.len() as u32;
            unsafe { GetMenuItemInfoW(menu, 0, true, &mut item).unwrap() };
            assert_eq!(
                String::from_utf16_lossy(&label[..item.cch as usize]),
                "Open tool center"
            );
            assert_eq!(item.wID, 42);
            assert_eq!(item.hbmpItem, HBITMAP(bitmap.0 as _));
            unsafe { DestroyMenu(menu).unwrap() };
        }
    }
}
