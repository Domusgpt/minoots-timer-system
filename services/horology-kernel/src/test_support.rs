pub mod postgres {
    use std::time::Duration;

    use sqlx::{postgres::PgPoolOptions, Pool, Postgres};

    pub static MIGRATOR: sqlx::migrate::Migrator =
        sqlx::migrate!("../../apps/control-plane/migrations");

    pub async fn init_test_pool() -> Option<Pool<Postgres>> {
        let url = std::env::var("TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .ok()?;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&url)
            .await
            .ok()?;
        if let Err(error) = MIGRATOR.run(&pool).await {
            eprintln!("[kernel-tests] failed to run migrations: {error}");
            return None;
        }
        Some(pool)
    }
}
