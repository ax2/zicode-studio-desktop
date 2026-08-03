use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use std::sync::Arc;

const PAGE_HEADERS: [(&str, &str); 4] = [
    ("cache-control", "no-store"),
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", "no-referrer"),
    (
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    ),
];

pub fn router(certificate_pem: String, fingerprint: String) -> Router {
    let page = Arc::new(enrollment_page(&fingerprint));
    let certificate = Arc::new(certificate_pem);
    Router::new()
        .route(
            "/",
            get({
                let page = page.clone();
                move || {
                    let page = page.clone();
                    async move { (PAGE_HEADERS, Html(page.as_str().to_owned())) }
                }
            }),
        )
        .route(
            "/ca.pem",
            get(move || {
                let certificate = certificate.clone();
                async move { certificate_response(certificate.as_str().to_owned()) }
            }),
        )
}

fn certificate_response(certificate: String) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-pem-file")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=ZiCode-Studio-Mobile-CA.pem",
        )
        .body(Body::from(certificate))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn enrollment_page(fingerprint: &str) -> String {
    format!(
        r##"<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#111827">
  <title>ZiCode 手机安全连接</title>
  <style>
    :root{{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif}}
    *{{box-sizing:border-box}}
    body{{min-height:100dvh;margin:0;background:radial-gradient(circle at 50% 0,#17314b 0,#0b1020 42%);color:#e5e7eb}}
    main{{width:min(100%,48rem);margin:auto;padding:max(1.25rem,env(safe-area-inset-top)) 1rem max(2rem,env(safe-area-inset-bottom))}}
    header{{padding:1.5rem 0;text-align:center}}
    .mark{{width:3.5rem;height:3.5rem;display:grid;place-items:center;margin:auto;border-radius:1.1rem;background:#2dd4bf;color:#052e2b;font-size:1.5rem;font-weight:800}}
    h1{{margin:.9rem 0 .35rem;font-size:clamp(1.55rem,6vw,2.2rem)}}
    header p{{margin:0;color:#9ca3af}}
    .card{{margin-bottom:1rem;padding:1.25rem;border:1px solid #2c3654;border-radius:1.25rem;background:rgba(21,27,46,.92);box-shadow:0 1rem 3rem rgba(0,0,0,.2)}}
    .security{{display:grid;grid-template-columns:auto 1fr;gap:.75rem;align-items:start}}
    .shield{{width:2.5rem;height:2.5rem;display:grid;place-items:center;border-radius:50%;background:rgba(45,212,191,.12);color:#5eead4}}
    h2{{margin:0 0 .35rem;font-size:1.05rem}}
    p{{margin:.3rem 0;color:#cbd5e1;line-height:1.55}}
    .tabs{{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem}}
    .tab{{min-height:2.75rem;border:1px solid #374151;border-radius:.75rem;background:#111827;color:#d1d5db;font:inherit;font-weight:650}}
    .tab[aria-selected="true"]{{border-color:#2dd4bf;background:rgba(45,212,191,.12);color:#5eead4}}
    ol{{display:grid;gap:1rem;margin:.75rem 0 0;padding:0;list-style:none;counter-reset:steps}}
    li{{position:relative;padding-left:2.7rem;color:#d1d5db;line-height:1.5;counter-increment:steps}}
    li::before{{content:counter(steps);position:absolute;left:0;width:1.8rem;height:1.8rem;display:grid;place-items:center;border-radius:50%;background:#1f2937;color:#5eead4;font-weight:750}}
    .platform[hidden]{{display:none}}
    .download{{min-height:3rem;display:flex;align-items:center;justify-content:center;margin:1.2rem 0 .65rem;padding:.65rem 1rem;border-radius:.8rem;background:#2dd4bf;color:#052e2b;text-decoration:none;font-weight:800}}
    .fingerprint{{display:flex;align-items:center;gap:.6rem;margin-top:.9rem;padding:.8rem;border:1px dashed #475569;border-radius:.75rem;background:#0f172a}}
    code{{min-width:0;flex:1;overflow-wrap:anywhere;color:#93c5fd;font-size:.74rem;line-height:1.45}}
    .copy{{min-height:2.5rem;padding:.4rem .75rem;border:1px solid #475569;border-radius:.65rem;background:#1f2937;color:#e5e7eb;font:inherit}}
    .warning{{color:#fbbf24}}
    .next{{border-color:rgba(45,212,191,.42);background:linear-gradient(145deg,rgba(13,148,136,.18),rgba(21,27,46,.92))}}
    small{{display:block;color:#94a3b8;line-height:1.5}}
  </style>
</head>
<body>
<main>
  <header><div class="mark" aria-hidden="true">Zi</div><h1>手机安全连接</h1><p>ZiCode Mobile Secure Setup</p></header>
  <section class="card security"><div class="shield" aria-hidden="true">✓</div><div><h2>这是一次性的信任设置</h2><p>此页面只用于安装你电脑生成的本地 CA。对话、文件和配对令牌不会经过这个 HTTP 页面。</p><small>This page only bootstraps trust for the HTTPS connection. It does not expose conversations, files, or pairing tokens.</small></div></section>
  <section class="card">
    <div class="tabs" role="tablist" aria-label="选择手机系统">
      <button class="tab" type="button" role="tab" data-platform="android" aria-selected="true">Android</button>
      <button class="tab" type="button" role="tab" data-platform="ios" aria-selected="false">iPhone / iPad</button>
    </div>
    <div class="platform" data-panel="android">
      <h2>Android 安装步骤</h2>
      <ol><li>下载 ZiCode 信任证书。</li><li>打开系统设置，搜索“安装证书”或“CA 证书”，从存储空间选择刚下载的文件。</li><li>系统出现安全警告时，确认这是你自己的 ZiCode 电脑后继续。</li></ol>
    </div>
    <div class="platform" data-panel="ios" hidden>
      <h2>iPhone / iPad 安装步骤</h2>
      <ol><li>下载描述文件后，在“设置”顶部打开“已下载描述文件”并安装。</li><li>进入“设置 → 通用 → 关于本机 → 证书信任设置”。</li><li>为 ZiCode Studio Mobile CA 开启完全信任。</li></ol>
    </div>
    <a class="download" href="/ca.pem" download="ZiCode-Studio-Mobile-CA.pem">下载信任证书 / Download certificate</a>
    <p class="warning">安装前，必须与桌面端“设置 → 远程访问”中的指纹逐字核对：</p>
    <div class="fingerprint"><code id="fingerprint">{fingerprint}</code><button class="copy" type="button" id="copy">复制</button></div>
  </section>
  <section class="card next"><h2>安装完成后</h2><p>返回电脑上的 ZiCode，打开目标对话，点击“在手机上打开”，再扫描新的会话二维码。二维码五分钟内有效且只能使用一次。</p><small>Return to ZiCode on your desktop and scan a fresh session QR code. Each pairing link expires after five minutes and can be used only once.</small></section>
</main>
<script>
  const tabs=[...document.querySelectorAll('[data-platform]')];
  const panels=[...document.querySelectorAll('[data-panel]')];
  function select(name){{for(const tab of tabs)tab.setAttribute('aria-selected',String(tab.dataset.platform===name));for(const panel of panels)panel.hidden=panel.dataset.panel!==name;}}
  for(const tab of tabs)tab.addEventListener('click',()=>select(tab.dataset.platform));
  if(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))select('ios');
  document.getElementById('copy').addEventListener('click',async(event)=>{{try{{await navigator.clipboard.writeText(document.getElementById('fingerprint').textContent);event.currentTarget.textContent='已复制';}}catch{{event.currentTarget.textContent='请长按复制';}}}});
</script>
</body>
</html>"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_has_platform_specific_steps_and_fingerprint() {
        let page = enrollment_page("AA:BB:CC");
        assert!(page.contains("Android 安装步骤"));
        assert!(page.contains("iPhone / iPad 安装步骤"));
        assert!(page.contains("AA:BB:CC"));
        assert!(page.contains("五分钟内有效且只能使用一次"));
    }

    #[test]
    fn certificate_response_is_download_only_and_not_cached() {
        let response = certificate_response("CERTIFICATE".into());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            response.headers()[header::CONTENT_DISPOSITION],
            "attachment; filename=ZiCode-Studio-Mobile-CA.pem"
        );
    }
}
