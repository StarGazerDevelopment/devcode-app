require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || 'https://xyzcompany.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'public-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// API Endpoint to get active users count
app.get('/api/active-users', async (req, res) => {
    try {
        let count = 142; // Fallback mock value

        // Try to fetch from Supabase if env vars are properly configured
        if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
            const { data, error } = await supabase
                .from('metrics')
                .select('active_users')
                .limit(1)
                .single();
            
            if (!error && data && data.active_users !== undefined) {
                count = data.active_users;
            }
        }
        
        // You could also add some jitter for demo purposes to simulate live users
        const jitter = Math.floor(Math.random() * 5) - 2; // -2 to +2
        
        res.json({ active_users: Math.max(0, count + jitter) });
    } catch (err) {
        console.error('Error fetching active users:', err);
        res.json({ active_users: 142 });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Website backend running on http://localhost:${PORT}`);
});
