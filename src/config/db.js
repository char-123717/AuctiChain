const { createClient } = require('@supabase/supabase-js');

// dotenv config sudah dipanggil di server.js, tidak perlu di sini
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing in .env file');
  console.error('Check environment variables:');
  console.error('  SUPABASE_URL or VITE_SUPABASE_URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
  console.error('Current values:', {
    url: supabaseUrl ? 'set' : 'missing',
    key: supabaseKey ? 'set' : 'missing'
  });
  process.exit(1);
}

console.log('Supabase connected successfully:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

class Database {
  async createUser(userData) {
    const { data, error } = await supabase
      .from('users')
      .insert([userData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getUserByEmail(email) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async getUserById(id) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async updateUser(email, updates) {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('email', email.toLowerCase())
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async createVerificationCode(codeData) {
    const { data, error } = await supabase
      .from('verification_codes')
      .insert([codeData])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getVerificationCode(code) {
    const { data, error } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async deleteVerificationCode(code) {
    const { error } = await supabase
      .from('verification_codes')
      .delete()
      .eq('code', code);

    if (error) throw error;
  }

  async cleanExpiredVerificationCodes() {
    const { error } = await supabase
      .from('verification_codes')
      .delete()
      .lt('expires_at', new Date().toISOString());

    if (error) console.error('Failed to clean expired codes:', error);
  }
}

const db = new Database();

setInterval(() => {
  db.cleanExpiredVerificationCodes();
}, 60 * 60 * 1000);

module.exports = db;