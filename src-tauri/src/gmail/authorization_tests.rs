use super::{api, oauth, AccountGate};
use axum::{
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap},
    routing::{get, post},
    Form, Json, Router,
};
use reqwest::Client;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{net::TcpListener, sync::Notify, time::timeout};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Stage {
    Exchange,
    Profile,
}

struct LocalAuthorization {
    paused: Stage,
    entered: Notify,
    release: Notify,
    requests: Mutex<Vec<(Stage, bool)>>,
}

impl LocalAuthorization {
    async fn record(&self, stage: Stage, previous: bool) {
        self.requests.lock().unwrap().push((stage, previous));
        if previous && stage == self.paused {
            self.entered.notify_one();
            self.release.notified().await;
        }
    }
}

async fn exchange_and_identify(
    client: &Client,
    base: &str,
    config: &oauth::Config,
    code: &str,
    stop: &CancellationToken,
) -> oauth::Result<String> {
    let endpoint = format!("{base}/token");
    let tokens = oauth::until_cancelled(
        stop,
        oauth::tokens(
            client,
            &endpoint,
            config,
            &[("grant_type", "authorization_code"), ("code", code)],
        ),
    )
    .await?;
    oauth::until_cancelled(stop, api::profile(client, base, &tokens.access_token)).await
}

#[tokio::test]
async fn cancelling_each_authorization_request_releases_the_same_account_for_retry() {
    for paused in [Stage::Exchange, Stage::Profile] {
        let fixture = Arc::new(LocalAuthorization {
            paused,
            entered: Notify::new(),
            release: Notify::new(),
            requests: Mutex::new(Vec::new()),
        });
        let app = Router::new()
            .route(
                "/token",
                post(|State(fixture): State<Arc<LocalAuthorization>>, Form(form): Form<HashMap<String, String>>| async move {
                    assert_eq!(form["grant_type"], "authorization_code");
                    let code = &form["code"];
                    fixture.record(Stage::Exchange, code == "previous").await;
                    Json(json!({"access_token":code,"scope":oauth::READ}))
                }),
            )
            .route(
                "/profile",
                get(|State(fixture): State<Arc<LocalAuthorization>>, headers: HeaderMap| async move {
                    let previous = headers[AUTHORIZATION] == "Bearer previous";
                    fixture.record(Stage::Profile, previous).await;
                    Json(json!({"emailAddress":"fixture@example.test"}))
                }),
            )
            .with_state(fixture.clone());
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let service = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        let config = oauth::Config {
            id: "local-fixture".into(),
            secret: Zeroizing::new("local-only".into()),
        };
        let gate = AccountGate::default();
        let previous_stop = gate.state.lock().unwrap().stop.clone();
        let previous = async {
            let _network = gate.network.lock().await;
            exchange_and_identify(&client, &base, &config, "previous", &previous_stop).await
        };
        let cancel_and_retry = async {
            fixture.entered.notified().await;
            let fresh_stop = {
                let mut state = gate.state.lock().unwrap();
                state.invalidate();
                assert_eq!(state.generation, 1);
                state.stop.clone()
            };
            let _network = gate.network.lock().await;
            exchange_and_identify(&client, &base, &config, "fresh", &fresh_stop).await
        };
        // The previous HTTP handler stays paused until the fresh grant has finished.
        let (cancelled, fresh) = timeout(Duration::from_secs(5), async {
            tokio::join!(previous, cancel_and_retry)
        })
        .await
        .unwrap_or_else(|_| panic!("cancel during {paused:?} held the account's network lock"));
        assert_eq!(cancelled, Err("gmail_cancelled"));
        assert_eq!(fresh.as_deref(), Ok("fixture@example.test"));
        fixture.release.notify_one();

        let mut expected = vec![(Stage::Exchange, true)];
        if paused == Stage::Profile {
            expected.push((Stage::Profile, true));
        }
        expected.extend([(Stage::Exchange, false), (Stage::Profile, false)]);
        assert_eq!(*fixture.requests.lock().unwrap(), expected);
        service.abort();
    }
}

#[tokio::test]
async fn cancelled_authorization_takes_precedence_over_a_ready_success() {
    let stop = CancellationToken::new();
    stop.cancel();
    let result = oauth::until_cancelled(&stop, std::future::ready(Ok("previous"))).await;
    assert_eq!(result, Err("gmail_cancelled"));
}
