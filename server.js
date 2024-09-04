const express = require('express');
const bodyParser = require('body-parser');
const knex = require('knex');
const path = require('path');

// Initialize express
const app = express();
const PORT = process.env.PORT || 3000;

// Database setup (SQLite in this example)
const db = knex({
    client: 'sqlite3',
    connection: {
        filename: path.join(__dirname, 'tracking.db')
    },
    useNullAsDefault: true
});

// Middleware to parse incoming JSON requests
app.use(bodyParser.json());

// Ensure that the database table exists (run on startup)
async function initializeDatabase() {
    const exists = await db.schema.hasTable('tracking_data');
    if (!exists) {
        await db.schema.createTable('tracking_data', (table) => {
            table.increments('id').primary();
            table.string('referrer').notNullable();
            table.string('page').notNullable();
            table.string('screen_resolution').notNullable();
            table.string('ip_address').notNullable();
            table.string('session_id').notNullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
        });
        console.log("Database initialized with 'tracking_data' table.");
    }
}
initializeDatabase();

// Route to handle POST requests from the tracking script
app.post('/api/event', async (req, res) => {
    try {
        const { referrer, page, screen_resolution, ip_address, session_id } = req.body;

        // Insert the data into the SQLite database
        await db('tracking_data').insert({
            referrer,
            page,
            screen_resolution,
            ip_address,
            session_id
        });

        // Respond with success
        res.status(200).json({ message: 'Event tracked successfully' });
    } catch (err) {
        console.error("Error saving tracking data:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Example route to retrieve data (for demonstration purposes)
app.get('/api/events', async (req, res) => {
    try {
        const data = await db('tracking_data').select('*').limit(100); // Get the last 100 events
        res.status(200).json(data);
    } catch (err) {
        console.error("Error retrieving tracking data:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
