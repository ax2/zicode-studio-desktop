use super::NotesVault;
use std::fs;

#[test]
fn saved_body_whitespace_survives_reopening_and_another_save() {
    let root =
        std::env::temp_dir().join(format!("zicode-note-whitespace-{}", uuid::Uuid::new_v4()));
    let plugins = root.join("plugins");
    let vault = NotesVault::new(plugins.clone()).unwrap();
    let notebook = vault
        .create_notebook("Whitespace regression", None, None)
        .unwrap();
    for content in [
        "",
        "body",
        "\n",
        "body\n",
        "body\n\n",
        "\n中文 📝  \n",
        "body\r\n",
    ] {
        let expected = content.replace("\r\n", "\n");
        let note = vault
            .create_note(&notebook.id, "Preserved", content, vec![], None, None)
            .unwrap();
        let reopened = NotesVault::new(plugins.clone()).unwrap();
        let read = reopened.get_note(&notebook.id, &note.summary.id).unwrap();
        assert_eq!(read.content, expected);
        assert_eq!(read.summary.version, note.summary.version);
    }
    fs::remove_dir_all(root).unwrap();
}
