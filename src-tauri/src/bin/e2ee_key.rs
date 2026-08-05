//! 打印桌面 E2EE 身份的公钥（base64）与指纹，供调试、验收脚本或二次开发
//! 使用。公钥是公开信息；私钥始终留在系统凭据库中。
//!
//! Run with: `cargo run --bin zicode-e2ee-key`

#![allow(dead_code)] // bin 只使用身份加载/公钥输出，其余 e2ee 项由主程序使用。

#[path = "../e2ee.rs"]
mod e2ee;

fn main() {
    match e2ee::E2eeIdentity::load_or_create() {
        Ok(identity) => {
            println!("{}", identity.public_key_base64());
            eprintln!("fingerprint: {}", identity.fingerprint());
        }
        Err(error) => {
            eprintln!("Cannot load the E2EE identity: {error}");
            std::process::exit(1);
        }
    }
}
