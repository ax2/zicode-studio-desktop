//! Fixed search providers; no arbitrary template or executable URL is persisted.
use super::Store;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SearchEngine { Bing, Baidu, Google, DuckDuckGo }
impl Store {
    pub fn search_engine(&self) -> Result<SearchEngine, String> {
        let value: String = self.0.query_row("SELECT engine FROM browser_search_preferences WHERE id=1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        serde_json::from_value(serde_json::Value::String(value)).map_err(|_| "Invalid browser search preference".into())
    }
    pub fn set_search_engine(&self, engine: SearchEngine) -> Result<SearchEngine, String> {
        let value = serde_json::to_value(engine).map_err(|e| e.to_string())?;
        self.0.execute("UPDATE browser_search_preferences SET engine=?1 WHERE id=1", [value.as_str().ok_or("Invalid search engine")?]).map_err(|e| e.to_string())?;
        Ok(engine)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn version_five_upgrade_and_restart_preserve_existing_data() {
        let root = std::env::temp_dir().join(format!("browser-search-{}", uuid::Uuid::new_v4()));
        let store = Store::open(&root).unwrap();
        store.set_startup(super::super::StartupMode::Workspace).unwrap();
        let before = store.state("owner").unwrap();
        store.0.execute_batch("DROP TABLE browser_search_preferences; PRAGMA user_version=5;").unwrap();
        drop(store);
        let store = Store::open(&root).unwrap();
        assert_eq!(store.search_engine().unwrap(), SearchEngine::Bing);
        for engine in [SearchEngine::Baidu, SearchEngine::Google, SearchEngine::DuckDuckGo] {
            store.set_search_engine(engine).unwrap();
            assert_eq!(Store::open(&root).unwrap().state("owner").unwrap().search_engine, engine);
        }
        let after = store.state("owner").unwrap();
        assert_eq!(after.profile_id, before.profile_id);
        assert_eq!(after.startup_mode, before.startup_mode);
        assert_eq!(after.session, before.session);
        assert!(serde_json::from_str::<SearchEngine>("\"javascript:alert(1)\"").is_err());
        assert!(store.0.execute("UPDATE browser_search_preferences SET engine='unknown'", []).is_err());
    }
}
