//! Mission definition revisions and per-conversation read watermarks.
use super::*;

fn has_column(connection: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info('{table}')"))?;
    Ok(statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|name| name == column))
}

fn contains_schema(
    connection: &Connection,
    name: &str,
    fragments: &[&str],
) -> rusqlite::Result<bool> {
    let sql: Option<String> = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name=?1",
            [name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(sql.is_some_and(|sql| fragments.iter().all(|fragment| sql.contains(fragment))))
}

pub(super) fn apply_schema(connection: &Connection) -> Result<()> {
    if has_column(connection, "mission", "source_branch")? {
        connection.execute_batch("ALTER TABLE mission DROP COLUMN source_branch;")?;
    }
    if !has_column(connection, "mission", "details_version")? {
        connection.execute_batch(
            "ALTER TABLE mission ADD COLUMN details_version INTEGER NOT NULL DEFAULT 1 CHECK(details_version >= 1);",
        )?;
    }
    if !has_column(connection, "mission_workspace", "base_branch")? {
        connection.execute_batch("ALTER TABLE mission_workspace ADD COLUMN base_branch TEXT;")?;
    }
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS mission_details_read (
            conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
            mission_id TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
            baseline_details_version INTEGER NOT NULL CHECK(baseline_details_version >= 1),
            last_read_details_version INTEGER CHECK(last_read_details_version IS NULL OR last_read_details_version >= 1),
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS mission_details_read_mission_idx
            ON mission_details_read(mission_id, conversation_id);",
    )?;
    Ok(())
}

pub(super) fn schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(!has_column(connection, "mission", "source_branch")?
        && contains_schema(
            connection,
            "mission",
            &[
                "details_version INTEGER NOT NULL DEFAULT 1",
                "details_version >= 1",
            ],
        )?
        && contains_schema(connection, "mission_workspace", &["base_branch TEXT"])?
        && contains_schema(
            connection,
            "mission_details_read",
            &[
                "conversation_id TEXT PRIMARY KEY NOT NULL",
                "baseline_details_version INTEGER NOT NULL",
                "last_read_details_version INTEGER",
                "REFERENCES conversation(id) ON DELETE CASCADE",
                "REFERENCES mission(id) ON DELETE CASCADE",
            ],
        )?
        && contains_schema(
            connection,
            "mission_details_read_mission_idx",
            &["mission_id", "conversation_id"],
        )?)
}

impl Database {
    pub(super) fn migrate_mission_details_v158(&mut self) -> Result<()> {
        self.connection.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let result = (|| -> Result<()> {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 107),
                "Mission details migration requires an admitted v1.59/schema 107 source"
            );
            apply_schema(&tx)?;
            tx.execute_batch(
                "INSERT INTO schema_migration VALUES(158,datetime('now'));
                 UPDATE rovai_data_contract SET projection_schema_version=108,updated_at=datetime('now') WHERE singleton=1;",
            )?;
            anyhow::ensure!(
                matches!(
                    classify_database_contract(&tx)?,
                    DatabaseContractClassification::Current(_)
                ),
                "Mission details migration failed schema admission"
            );
            validate_migration_foreign_keys(
                &tx,
                &["mission", "mission_workspace", "mission_details_read"],
            )?;
            tx.commit()?;
            Ok(())
        })();
        let restore = self.connection.execute_batch("PRAGMA foreign_keys=ON;");
        result?;
        restore?;
        Ok(())
    }
}
