const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load .env from root

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase credentials missing in .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupDatabase() {
    try {
        console.log('Setting up database tables...');

        // Adjusted path to point to root/supabase/...
        const migrationFile = path.join(__dirname, '..', 'supabase', 'migrations', '20240101000000_create_users_table.sql');
        const sql = fs.readFileSync(migrationFile, 'utf8');

        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            console.error('Migration error:', error);
            console.log('\nPlease run the SQL manually in Supabase SQL Editor:');
            console.log('\n' + sql);
            process.exit(1);
        }

        console.log('Database setup completed successfully!');
    } catch (error) {
        console.error('Setup error:', error.message);
        console.log('\nPlease run the SQL manually in Supabase SQL Editor.');
        console.log('File location:', path.join(__dirname, '..', 'supabase', 'migrations', '20240101000000_create_users_table.sql'));
        process.exit(1);
    }
}

setupDatabase();