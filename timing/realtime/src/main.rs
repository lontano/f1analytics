use anyhow::Error;
use shared::tracing_subscriber;
use tokio::sync::broadcast;
use tracing::warn;

use crate::services::persist_service::start_persist_service;
use crate::services::state_service::StateService;

mod f1;
mod http_server;
mod services {
    pub mod persist_service;
    pub mod state_service;
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber();

    let state_service = StateService::new();

    let (sender, _) = broadcast::channel::<String>(16);
    let db = if std::env::var("DATABASE_URL").is_err() {
        None
    } else {
        let mut pool = None;

        for attempt in 1..=15 {
            match storage::init_db(true).await {
                Ok(p) => {
                    pool = Some(p);
                    break;
                }
                Err(err) => {
                    warn!(
                        attempt,
                        ?err,
                        "failed to init database (DATABASE_URL), retrying..."
                    );
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                }
            }
        }

        pool
    };

    let persist = start_persist_service(db.clone());

    {
        let state_service = state_service.clone();
        let sender = sender.clone();
        let persist_tx = persist.tx.clone();
        tokio::spawn(async move {
            loop {
                match f1::ingest_f1(state_service.clone(), sender.clone(), persist_tx.clone()).await
                {
                    Ok(_) => {}
                    Err(err) => {
                        warn!(?err, "ingest_f1 method returned error");
                    }
                };

                warn!("ingest_f1 method returned, possible session change, restarting...");
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            }
        });
    }

    http_server::start(state_service, sender, db).await?;

    Ok(())
}
