use super::site::{self, Layout};
use serde::Serialize;
use std::{fs, io::ErrorKind, path::Path};

#[derive(Serialize)]
pub(super) struct DefaultHomepage {
    path: &'static str,
    status: Status,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Found,
    Missing,
    Unavailable,
}

pub(super) fn inspect(root: &Path, layout: Layout) -> DefaultHomepage {
    let path = match layout {
        Layout::Astro => "dist/index.html",
        Layout::Hugo(_) => "public/index.html",
    };
    let status = match site::checked(root, path, true) {
        Ok(file) => match fs::symlink_metadata(file) {
            Ok(metadata) if metadata.is_file() && metadata.len() > 0 => Status::Found,
            Err(error) if error.kind() == ErrorKind::NotFound => Status::Missing,
            _ => Status::Unavailable,
        },
        Err(_) => Status::Unavailable,
    };
    DefaultHomepage { path, status }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspects_only_each_frameworks_default_homepage() {
        let root = tempfile::tempdir().unwrap();
        let astro = root.path().join("astro");
        let hugo = root.path().join("hugo");
        for root in [&astro, &hugo] {
            fs::create_dir_all(root.join("public")).unwrap();
            fs::create_dir_all(root.join("dist")).unwrap();
        }
        let fixture = b"<!doctype html><title>Owned site</title>";
        fs::write(astro.join("public/index.html"), fixture).unwrap();
        fs::write(hugo.join("dist/index.html"), fixture).unwrap();
        let astro_report = inspect(&astro, Layout::Astro);
        assert_eq!(astro_report.path, "dist/index.html");
        assert_eq!(astro_report.status, Status::Missing);
        let hugo_report = inspect(&hugo, Layout::Hugo("content/posts"));
        assert_eq!(hugo_report.path, "public/index.html");
        assert_eq!(hugo_report.status, Status::Missing);
        fs::write(astro.join(astro_report.path), fixture).unwrap();
        fs::write(hugo.join(hugo_report.path), fixture).unwrap();
        assert_eq!(inspect(&astro, Layout::Astro).status, Status::Found);
        assert_eq!(
            inspect(&hugo, Layout::Hugo("content/posts")).status,
            Status::Found
        );
        assert_eq!(fs::read(astro.join(astro_report.path)).unwrap(), fixture);
        assert_eq!(fs::read(hugo.join(hugo_report.path)).unwrap(), fixture);
    }

    #[test]
    fn declines_empty_files_and_directories() {
        let root = tempfile::tempdir().unwrap();
        let homepage = root.path().join("dist/index.html");
        fs::create_dir_all(homepage.parent().unwrap()).unwrap();
        fs::write(&homepage, b"").unwrap();
        assert_eq!(
            inspect(root.path(), Layout::Astro).status,
            Status::Unavailable
        );
        fs::remove_file(&homepage).unwrap();
        fs::create_dir(&homepage).unwrap();
        assert_eq!(
            inspect(root.path(), Layout::Astro).status,
            Status::Unavailable
        );
    }

    #[test]
    fn declines_linked_output_directories() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("project");
        let outside = temp.path().join("elsewhere");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("index.html"), "<h1>Outside the site</h1>").unwrap();
        #[cfg(windows)]
        {
            let status = crate::process_command::new_command("cmd.exe")
                .args(["/d", "/c", "mklink", "/J", "dist", r"..\elsewhere"])
                .current_dir(crate::process_command::working_directory(&root))
                .output()
                .unwrap();
            assert!(status.status.success(), "{:?}", status.status);
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside, root.join("dist")).unwrap();
        assert_eq!(inspect(&root, Layout::Astro).status, Status::Unavailable);
    }
}
