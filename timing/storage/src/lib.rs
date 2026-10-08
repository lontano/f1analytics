use std::env;

use anyhow::Error;
use sqlx::{PgPool, postgres::PgPoolOptions};

pub const STORAGE_CRATE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub type DbPool = PgPool;

pub async fn init_db(migrate: bool) -> Result<PgPool, Error> {
    let database_url = env::var("DATABASE_URL")?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    if migrate {
        sqlx::migrate!().run(&pool).await?;
    }

    Ok(pool)
}

pub mod ingest;
pub mod query;

