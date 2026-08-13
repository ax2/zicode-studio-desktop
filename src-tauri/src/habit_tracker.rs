//! Habit tracker: a workspace-scoped store for habits and daily check-ins.

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_HABITS: usize = 200;
const MAX_NAME_CHARS: usize = 120;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub color: String,
    pub created_at: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitEntry {
    pub habit_id: String,
    pub date: String,
    pub value: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HabitsFile {
    habits: Vec<Habit>,
    entries: Vec<HabitEntry>,
}

fn habits_path(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(".zicode")
        .join("habits")
        .join("habits.json")
}

fn read_file(workspace_root: &Path) -> HabitsFile {
    std::fs::read(habits_path(workspace_root))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<HabitsFile>(&bytes).ok())
        .unwrap_or_default()
}

fn write_file(workspace_root: &Path, file: &HabitsFile) -> Result<(), String> {
    let path = habits_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create habits directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(file)
        .map_err(|error| format!("Cannot serialize habits: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| format!("Cannot save habits: {error}"))
}

pub fn list(workspace_root: &Path) -> (Vec<Habit>, Vec<HabitEntry>) {
    let file = read_file(workspace_root);
    (file.habits, file.entries)
}

pub fn upsert(
    workspace_root: &Path,
    id: Option<&str>,
    name: &str,
    emoji: &str,
    color: &str,
) -> Result<Habit, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Habit name is required".to_string());
    }
    if trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "Habit name exceeds the {MAX_NAME_CHARS} character limit"
        ));
    }
    let mut file = read_file(workspace_root);
    let habit = if let Some(existing_id) = id {
        let habit = file
            .habits
            .iter_mut()
            .find(|habit| habit.id == existing_id)
            .ok_or_else(|| "Habit not found".to_string())?;
        habit.name = trimmed.to_string();
        habit.emoji = emoji.trim().to_string();
        habit.color = color.trim().to_string();
        habit.clone()
    } else {
        if file.habits.len() >= MAX_HABITS {
            return Err(format!(
                "The maximum of {MAX_HABITS} habits has been reached"
            ));
        }
        let habit = Habit {
            id: Uuid::new_v4().simple().to_string(),
            name: trimmed.to_string(),
            emoji: emoji.trim().to_string(),
            color: color.trim().to_string(),
            created_at: Utc::now().to_rfc3339(),
            archived: false,
        };
        file.habits.insert(0, habit.clone());
        habit
    };
    write_file(workspace_root, &file)?;
    Ok(habit)
}

pub fn toggle(
    workspace_root: &Path,
    habit_id: &str,
    date: &str,
) -> Result<Option<HabitEntry>, String> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| "Habit date must use YYYY-MM-DD format".to_string())?;
    let mut file = read_file(workspace_root);
    if !file.habits.iter().any(|habit| habit.id == habit_id) {
        return Err("Habit not found".to_string());
    }
    let existing = file
        .entries
        .iter()
        .position(|entry| entry.habit_id == habit_id && entry.date == date);
    let result = match existing {
        Some(index) => {
            file.entries.remove(index);
            None
        }
        None => {
            let entry = HabitEntry {
                habit_id: habit_id.to_string(),
                date: date.to_string(),
                value: 1.0,
            };
            file.entries.push(entry.clone());
            Some(entry)
        }
    };
    write_file(workspace_root, &file)?;
    Ok(result)
}

pub fn remove(workspace_root: &Path, habit_id: &str) -> Result<bool, String> {
    let mut file = read_file(workspace_root);
    let before = file.habits.len();
    file.habits.retain(|habit| habit.id != habit_id);
    let removed = file.habits.len() < before;
    file.entries.retain(|entry| entry.habit_id != habit_id);
    write_file(workspace_root, &file)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("habit-tracker-test-{}", Uuid::new_v4().simple()))
    }

    #[test]
    fn upserts_and_lists_habits() {
        let root = tmp_root();
        let habit = upsert(&root, None, "  Read  ", "📖", "#4f8cff").unwrap();
        assert_eq!(habit.name, "Read");
        let (habits, _) = list(&root);
        assert_eq!(habits.len(), 1);
        let updated = upsert(&root, Some(&habit.id), "Read 20 pages", "📚", "#2bb673").unwrap();
        assert_eq!(updated.name, "Read 20 pages");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn toggles_and_removes_entries() {
        let root = tmp_root();
        let habit = upsert(&root, None, "Walk", "🚶", "#2bb673").unwrap();
        assert!(toggle(&root, &habit.id, "2026-08-13").unwrap().is_some());
        let (_, entries) = list(&root);
        assert_eq!(entries.len(), 1);
        assert!(toggle(&root, &habit.id, "2026-08-13").unwrap().is_none());
        let (_, entries) = list(&root);
        assert!(entries.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn removes_habits_with_their_entries() {
        let root = tmp_root();
        let habit = upsert(&root, None, "Meditate", "🧘", "#c15f9f").unwrap();
        toggle(&root, &habit.id, "2026-08-13").unwrap();
        assert!(remove(&root, &habit.id).unwrap());
        let (habits, entries) = list(&root);
        assert!(habits.is_empty());
        assert!(entries.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_invalid_dates() {
        let root = tmp_root();
        let habit = upsert(&root, None, "Run", "🏃", "#e0a63f").unwrap();
        assert!(toggle(&root, &habit.id, "not-a-date").is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}
