pub(super) fn prefix(value: &str, budget: usize) -> String {
    let mut units = 0;
    value.chars().take_while(|c| { units += c.len_utf16(); units <= budget }).collect()
}

pub fn filename(value: &str) -> String {
    let name = value.rsplit(['/', '\\']).next().unwrap_or("");
    let name: String = name.chars().filter(|c| !c.is_control())
        .map(|c| if "<>:\"|?*".contains(c) { '_' } else { c }).collect();
    let name = name.trim_matches([' ', '.']);
    let name = if name.encode_utf16().count() > 180 {
        // Preserve the true extension even for long Unicode suggestions.
        match name.rsplit_once('.') {
            Some((stem, extension)) if !stem.is_empty() && extension.encode_utf16().count() <= 16 => {
                format!("{}.{}", prefix(stem, 179 - extension.encode_utf16().count()).trim_end_matches([' ', '.']), extension)
            },
            _ => prefix(name, 180),
        }
    } else { name.to_owned() };
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() || ["CON", "PRN", "AUX", "NUL", "CLOCK$"].contains(&stem.as_str())
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.ends_with(['1','2','3','4','5','6','7','8','9'])) {
        "download.bin".into()
    } else { name }
}
