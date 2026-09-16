//! Mission definition revisions, stable numbers, and delivered-version watermarks.
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

pub(super) fn v158_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
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

fn object_exists(connection: &Connection, name: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name=?1)",
        [name],
        |row| row.get(0),
    )
}

pub(super) fn apply_delivery_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS mission_number_sequence (
            number INTEGER PRIMARY KEY AUTOINCREMENT
        );",
    )?;
    if !has_column(connection, "mission", "number")? {
        connection.execute_batch(
            "CREATE TABLE mission_v159 (
                id TEXT PRIMARY KEY NOT NULL,
                number INTEGER NOT NULL UNIQUE CHECK(number >= 1),
                camp_id TEXT NOT NULL UNIQUE REFERENCES camp(id) ON DELETE CASCADE,
                title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
                description TEXT NOT NULL CHECK(length(description) <= 12000),
                status TEXT NOT NULL CHECK(status IN ('needs_you','not_started','in_progress','completed')),
                source_message_id TEXT,
                tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
                details_version INTEGER NOT NULL DEFAULT 1 CHECK(details_version >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            WITH ranked AS (
                SELECT id,ROW_NUMBER() OVER (ORDER BY created_at,id) AS number,camp_id,title,description,status,
                       source_message_id,tags_json,details_version,created_at,updated_at
                FROM mission
            )
            INSERT INTO mission_v159(id,number,camp_id,title,description,status,source_message_id,tags_json,details_version,created_at,updated_at)
            SELECT id,number,camp_id,title,description,status,source_message_id,tags_json,details_version,created_at,updated_at FROM ranked;
            DROP TABLE mission;
            ALTER TABLE mission_v159 RENAME TO mission;
            CREATE INDEX mission_updated_idx ON mission(updated_at DESC,id DESC);",
        )?;
    }
    connection.execute_batch(
        "INSERT OR IGNORE INTO mission_number_sequence(number) SELECT number FROM mission;",
    )?;
    if has_column(connection, "mission_start", "title")?
        || has_column(connection, "mission_start", "description")?
    {
        connection.execute_batch(
            "CREATE TABLE mission_start_v159 (
                message_id TEXT PRIMARY KEY NOT NULL REFERENCES camp_message(id) ON DELETE CASCADE,
                mission_id TEXT NOT NULL REFERENCES mission(id) ON DELETE CASCADE,
                camp_turn_id TEXT NOT NULL UNIQUE REFERENCES camp_turn(id) ON DELETE CASCADE,
                command_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            INSERT INTO mission_start_v159(message_id,mission_id,camp_turn_id,command_id,created_at)
            SELECT message_id,mission_id,camp_turn_id,command_id,created_at FROM mission_start;
            DROP TABLE mission_start;
            ALTER TABLE mission_start_v159 RENAME TO mission_start;",
        )?;
    }
    if !has_column(
        connection,
        "conversation",
        "mission_details_delivered_version",
    )? {
        connection.execute_batch(
            "ALTER TABLE conversation ADD COLUMN mission_details_delivered_version INTEGER
             CHECK(mission_details_delivered_version IS NULL OR mission_details_delivered_version >= 1);",
        )?;
    }
    if !has_column(connection, "context_manifest", "mission_details_version")? {
        connection.execute_batch(
            "ALTER TABLE context_manifest ADD COLUMN mission_details_version INTEGER
             CHECK(mission_details_version IS NULL OR mission_details_version >= 1);",
        )?;
    }
    connection.execute_batch(
        "UPDATE mission_activity
         SET changes_json=json_set(json_remove(changes_json,'$.title'),'$.titleChanged',json('true'))
         WHERE json_type(changes_json,'$.title') IS NOT NULL;
         UPDATE mission_activity
         SET changes_json=json_set(json_remove(changes_json,'$.description'),'$.descriptionChanged',json('true'))
         WHERE json_type(changes_json,'$.description') IS NOT NULL;
         UPDATE event_log
         SET payload_json=json_set(json_remove(payload_json,'$.changes.title'),'$.changes.titleChanged',json('true'))
         WHERE event_type='mission.updated' AND json_type(payload_json,'$.changes.title') IS NOT NULL;
         UPDATE event_log
         SET payload_json=json_set(json_remove(payload_json,'$.changes.description'),'$.changes.descriptionChanged',json('true'))
         WHERE event_type='mission.updated' AND json_type(payload_json,'$.changes.description') IS NOT NULL;
         DROP INDEX IF EXISTS mission_details_read_mission_idx;
         DROP TABLE IF EXISTS mission_details_read;",
    )?;
    Ok(())
}

pub(super) fn v159_schema_matches(connection: &Connection) -> rusqlite::Result<bool> {
    Ok(contains_schema(
        connection,
        "mission",
        &["number INTEGER NOT NULL UNIQUE", "number >= 1"],
    )? && contains_schema(
        connection,
        "mission_number_sequence",
        &["number INTEGER PRIMARY KEY AUTOINCREMENT"],
    )? && !has_column(connection, "mission_start", "title")?
        && !has_column(connection, "mission_start", "description")?
        && contains_schema(
            connection,
            "conversation",
            &["mission_details_delivered_version INTEGER"],
        )?
        && contains_schema(
            connection,
            "context_manifest",
            &["mission_details_version INTEGER"],
        )?
        && !object_exists(connection, "mission_details_read")?)
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
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 108),
                "Mission details migration failed source admission"
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

    pub(super) fn migrate_mission_delivery_v159(&mut self) -> Result<()> {
        self.connection.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let result = (|| -> Result<()> {
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            anyhow::ensure!(
                matches!(classify_database_contract(&tx)?, DatabaseContractClassification::SupportedMigrationSource(ref marker)
                    if marker.contract_version == "v1.59" && marker.projection_schema_version == 108),
                "Mission delivery migration requires an admitted v1.59/schema 108 source"
            );
            apply_delivery_schema(&tx)?;
            tx.execute_batch(
                "INSERT INTO schema_migration VALUES(159,datetime('now'));
                 UPDATE rovai_data_contract SET projection_schema_version=109,updated_at=datetime('now') WHERE singleton=1;",
            )?;
            anyhow::ensure!(
                matches!(
                    classify_database_contract(&tx)?,
                    DatabaseContractClassification::Current(_)
                ),
                "Mission delivery migration failed schema admission"
            );
            validate_migration_foreign_keys(
                &tx,
                &[
                    "mission",
                    "mission_start",
                    "mission_activity",
                    "mission_workspace",
                ],
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
