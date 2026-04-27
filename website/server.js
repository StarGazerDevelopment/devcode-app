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

// In-memory fallback if no DB (will reset per Vercel serverless instance spin-up)
const activeSessions = new Map();

// API Endpoint for the app to ping and report activity
app.post('/api/ping', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
            // Upsert into active_sessions table with the current timestamp
            // Assume table has columns: id (text/uuid), last_seen (timestamp with time zone)
            await supabase
                .from('active_sessions')
                .upsert({ id: String(userId), last_seen: new Date().toISOString() });
        } else {
            // Fallback
            activeSessions.set(userId, Date.now());
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Ping error:', err);
        res.status(500).json({ success: false });
    }
});

// API Endpoint to get active users count
app.get('/api/active-users', async (req, res) => {
    try {
        let count = 0; // True base value

        // Try to fetch from Supabase if env vars are properly configured
        if (process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
            // Count users who have pinged in the last 2 minutes
            const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
            const { count: activeCount, error } = await supabase
                .from('active_sessions')
                .select('*', { count: 'exact', head: true })
                .gte('last_seen', twoMinsAgo);
            
            if (!error && activeCount !== null) {
                count = activeCount;
            } else if (error) {
                console.error("Supabase Error:", error.message);
            }
        } else {
            // Clean up old memory sessions
            const now = Date.now();
            for (const [id, lastSeen] of activeSessions.entries()) {
                if (now - lastSeen > 2 * 60 * 1000) activeSessions.delete(id);
            }
            // Use real memory count
            count = activeSessions.size;
        }
        
        res.json({ active_users: Math.max(0, count) });
    } catch (err) {
        console.error('Error fetching active users:', err);
        res.json({ active_users: 0 });
    }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Website backend running on http://localhost:${PORT}`);
    });
}

// Export for Vercel serverless function
module.exports = app;
