require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initializeDatabase, query } = require('../config/db');

async function runMigrations() {
  console.log('🚀 Starting Database Migrations...');
  await initializeDatabase();

  try {
    // 1. Create migrations tracking table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Fetch already executed migrations
    let executedRows = [];
    try {
      executedRows = await query('SELECT migration_name FROM schema_migrations');
    } catch (e) {
      executedRows = [];
    }

    const executedMigrations = new Set(executedRows.map(row => row.migration_name));

    // 3. Read migration files from migrations directory
    const migrationsDir = path.join(__dirname, '../migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('⚠️ No migrations directory found.');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;

    for (const file of migrationFiles) {
      if (executedMigrations.has(file)) {
        console.log(`⏩ [Skipping] ${file} (Already executed)`);
        continue;
      }

      console.log(`⏳ [Executing] ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');

      // Split statements and execute sequentially
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        await query(statement);
      }

      // Record migration
      await query('INSERT INTO schema_migrations (migration_name) VALUES (?)', [file]);
      console.log(`✅ [Applied] ${file}`);
      appliedCount++;
    }

    if (appliedCount === 0) {
      console.log('✨ All migrations are already up to date!');
    } else {
      console.log(`🎉 Successfully applied ${appliedCount} new migration(s)!`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigrations().then(() => {
    console.log('🏁 Migration process completed.');
    process.exit(0);
  });
}

module.exports = { runMigrations };
