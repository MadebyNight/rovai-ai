//! Extend public input admission without rewriting retained payloads or authorization.
use super::*;

const FACT40: &str = "(context_manifest_version = 40 AND formatter_version = 40 AND run_facts_schema_version = 11 AND";
const FACT43: &str = "(context_manifest_version = 43 AND formatter_version = 43 AND run_facts_schema_version = 11 AND";
const PROFILE: &str =
    "(NEW.context_manifest_version=43 AND NEW.context_delivery_profile_version=15) OR ";

fn schema(c: &Connection, kind: &str, name: &str) -> Result<String> {
    Ok(c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |r| r.get(0),
    )?)
}

pub(super) fn schema_matches(c: &Connection) -> rusqlite::Result<bool> {
    Ok(single_chat_facts::schema_matches(c)?
        && schema(c, "table", "context_manifest")
            .is_ok_and(|s| s.contains(FACT43) && s.contains("40, 41, 42, 43"))
        && schema(c, "table", "agent_run_input").is_ok_and(|s| s.contains("38, 39, 40, 43)"))
        && schema(c, "trigger", "agent_run_input_v43_only_insert")
            .is_ok_and(|s| s.contains("IS NOT 43") && s.contains("IS NOT 44"))
        && schema(c, "trigger", "context_manifest_v40_only_insert").is_ok_and(|s| {
            s.contains("NEW.context_manifest_version = 43")
                && s.contains("input.context_manifest_version IS NOT 43")
        })
        && schema(c, "trigger", "context_manifest_quote_profile_insert")
            .is_ok_and(|s| s.contains(PROFILE))
        && schema(
            c,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )
        .is_ok_and(|s| s.contains("40, 41, 42, 43")))
}

pub(super) fn migrate(database: &mut Database) -> Result<()> {
    database
        .connection
        .execute_batch("PRAGMA foreign_keys=OFF;")?;
    let result = (|| -> Result<()> {
        let tx = database
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let marker = match classify_database_contract(&tx)? {
            DatabaseContractClassification::SupportedMigrationSource(m)
                if m.projection_schema_version == 172 =>
            {
                m
            }
            _ => anyhow::bail!("Chat reply context requires complete schema 172"),
        };
        anyhow::ensure!(
            matches!(
                classify_chat_schema(&tx, marker)?,
                DatabaseContractClassification::Current(_)
            ),
            "Chat reply context requires complete chat migrations"
        );
        let legacy = !schema(&tx, "table", "context_manifest")?.contains(FACT43);
        if legacy {
        let old = schema(&tx, "table", "context_manifest")?;
        let start = old.find(FACT40).context("Missing public facts clause")?;
        let end = start
            + old[start..]
                .find("\n OR\n")
                .context("Missing public facts boundary")?;
        let retained = &old[start..end];
        let manifest = replacement_table_schema_v171(old.clone(), "context_manifest")
            .replace("38, 39, 40, 41, 42)", "38, 39, 40, 41, 42, 43)")
            .replace(
                retained,
                &format!("{}\n OR\n {retained}", retained.replace(FACT40, FACT43)),
            );
        let old_guard = schema(&tx, "trigger", "context_manifest_v40_only_insert")?;
        let start = old_guard
            .find("(NEW.source_delivery_id IS NOT NULL AND NEW.context_manifest_version = 40")
            .context("Missing public admission")?;
        let end = start
            + old_guard[start..]
                .find(" OR (NEW.source_delivery_id IS NOT NULL")
                .context("Missing retained admission boundary")?;
        let addition = old_guard[start..end]
            .replace("= 40", "= 43")
            .replace("IS NOT 40", "IS NOT 43");
        let guard = old_guard.replacen("WHEN NOT (", &format!("WHEN NOT ({addition} OR "), 1);
        let profile = schema(&tx, "trigger", "context_manifest_quote_profile_insert")?.replacen(
            "WHEN NOT (",
            &format!("WHEN NOT ({PROFILE}"),
            1,
        );
        let input = replacement_table_schema_v171(
            schema(&tx, "table", "agent_run_input")?,
            "agent_run_input",
        )
        .replace("38, 39, 40)", "38, 39, 40, 43)");
        let attachment = schema(
            &tx,
            "trigger",
            "runtime_input_delivery_attachment_auth_insert",
        )?
        .replace("38, 39, 40, 41, 42)", "38, 39, 40, 41, 42, 43)");
        rebuild_table_v171(
            &tx,
            "context_manifest",
            &manifest,
            &[],
            &[
                "context_manifest_v40_only_insert",
                "context_manifest_quote_profile_insert",
            ],
        )?;
        rebuild_table_v171(
            &tx,
            "agent_run_input",
            &input,
            &[],
            &["agent_run_input_v40_only_insert"],
        )?;
        tx.execute_batch(&guard)?;
        tx.execute_batch(&profile)?;
        tx.execute_batch("DROP TRIGGER runtime_input_delivery_attachment_auth_insert;")?;
        tx.execute_batch(&attachment)?;
        }
        tx.execute_batch("DROP TRIGGER IF EXISTS agent_run_input_v43_only_insert; CREATE TRIGGER agent_run_input_v43_only_insert BEFORE INSERT ON agent_run_input WHEN NEW.context_manifest_version IS NOT 43 AND NEW.context_manifest_version IS NOT 44 BEGIN SELECT RAISE(ABORT,'new public Thread AgentRunInput must use ContextManifest v43/v44'); END;")?;
        tx.execute_batch("INSERT INTO schema_migration VALUES(223,datetime('now')); UPDATE rovai_data_contract SET projection_schema_version=173,updated_at=datetime('now') WHERE singleton=1;")?;
        validate_migration_foreign_keys(
            &tx,
            &[
                "context_manifest",
                "agent_run_input",
                "runtime_input_delivery",
            ],
        )?;
        anyhow::ensure!(
            schema_matches(&tx)?
                && matches!(
                    classify_database_contract(&tx)?,
                    DatabaseContractClassification::Current(_)
                ),
            "Chat reply context admission failed"
        );
        tx.commit()?;
        Ok(())
    })();
    let restored = database.connection.execute_batch("PRAGMA foreign_keys=ON;");
    result?;
    restored?;
    Ok(())
}

// Synthetic historical layouts only; production never downgrades frozen input.
#[cfg(test)]
pub(super) fn downgrade_for_test(c: &Connection) {
    if !c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=223)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    {
        return;
    }
    c.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    // The reply receipt is the only durable difference this migration adds on a
    // ContextManifest v44 database; the fence trigger is recreated by migrate.
    tx.execute_batch(
        "DROP TRIGGER IF EXISTS agent_run_input_v43_only_insert;
         DELETE FROM schema_migration WHERE version=223;
         UPDATE rovai_data_contract SET projection_schema_version=172 WHERE singleton=1;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
}

#[cfg(test)]
pub(super) fn assert_upgrade(db: &mut Database) {
    downgrade_for_test(db.connection());
    let before = public_history_claim_preserved_evidence_digest(db.connection()).unwrap();
    db.connection().execute_batch("CREATE TEMP TRIGGER reject_chat_reply_receipt BEFORE INSERT ON schema_migration WHEN NEW.version=223 BEGIN SELECT RAISE(ABORT,'chat reply rollback'); END;").unwrap();
    let error = migrate(db).unwrap_err();
    assert!(error.to_string().contains("chat reply rollback"), "{error:#}");
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(
        matches!(classify_database_contract(db.connection()).unwrap(),DatabaseContractClassification::SupportedMigrationSource(ref m) if m.projection_schema_version==172)
    );
    assert_eq!(
        db.connection()
            .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    db.connection()
        .execute_batch("DROP TRIGGER reject_chat_reply_receipt;")
        .unwrap();
    migrate(db).unwrap();
    assert_eq!(
        before,
        public_history_claim_preserved_evidence_digest(db.connection()).unwrap()
    );
    assert!(matches!(
        classify_database_contract(db.connection()).unwrap(),
        DatabaseContractClassification::Current(_)
    ));
    assert!(schema_matches(db.connection()).unwrap());
}
