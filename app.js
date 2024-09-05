const express = require('express');
const { CosmosClient } = require('@azure/cosmos');

const app = express();
const port = process.env.PORT || 8080;

// Set up Cosmos DB connection
const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = 'RTP';
const containerId = 'pageanalytics';

const client = new CosmosClient({ endpoint, key });
const database = client.database(databaseId);
const container = database.container(containerId);

// Middleware to parse JSON bodies
app.use(express.json());

// Route to handle event tracking from client-side JavaScript
app.post('/api/event', async (req, res) => {
    const eventData = req.body;
    
    // Make sure to add a unique ID to each event
    eventData.id = `event_${Date.now()}`;
    
    try {
        // Insert the event data into Cosmos DB
        const { resource: createdItem } = await container.items.create(eventData);
        res.status(201).json(createdItem);
    } catch (error) {
        console.error('Error saving event to Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to save event data' });
    }
});

// Example route to retrieve events by session ID
app.get('/api/events/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.session_id = @sessionId',
            parameters: [{ name: '@sessionId', value: sessionId }]
        };
        
        const { resources: events } = await container.items.query(querySpec).fetchAll();
        res.status(200).json(events);
    } catch (error) {
        console.error('Error querying events from Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to retrieve events' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
