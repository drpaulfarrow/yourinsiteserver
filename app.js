const express = require('express');
const { CosmosClient } = require('@azure/cosmos');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 8080;

// Configure CORS options
const corsOptions = {
    origin: 'https://yourin.site',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};

// Set up Cosmos DB connection
const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = 'RTP';
const containerId = 'pageanalytics';
const aggContainerId = 'pageanalytics_aggregated'; 

const client = new CosmosClient({ endpoint, key });
const database = client.database(databaseId);
const container = database.container(containerId);
const aggContainer = database.container(aggContainerId);

// Use the cors middleware with the specified options
app.use(cors(corsOptions));

// Middleware to parse JSON bodies
app.use(express.json());

// Route to handle event tracking from client-side JavaScript
app.post('/api/event', async (req, res) => {
    const eventData = req.body;

    // Get client IP from the request
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('Client IP:', clientIP);

    // Skip geolocation for localhost or internal IP addresses
    const isLocalhost = clientIP === '127.0.0.1' || clientIP === '::1';
    if (isLocalhost) {
        console.log('Skipping geolocation for localhost IP:', clientIP);
        eventData.location = { city: 'localhost', country: 'localhost' };
    } else {
        // Perform a geolocation lookup for the IP address
        const location = await getLocationFromIP(clientIP); // Implement this function with a geolocation service
        eventData.location = location;
    }

    eventData.ip_address = clientIP;
    eventData.id = `event_${Date.now()}`;
    
    try {
        const { resource: createdItem } = await container.items.create(eventData);
        res.status(201).json(createdItem);
    } catch (error) {
        console.error('Error saving event to Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to save event data' });
    }
});

// Function to get location from IP using an external service
async function getLocationFromIP(ip) {
    try {
        const response = await axios.get(`https://api.ipgeolocation.io/ipgeo?apiKey=YOUR_API_KEY&ip=${ip}`);
        const location = {
            city: response.data.city,
            region: response.data.state_prov,
            country: response.data.country_name,
        };
        return location;
    } catch (error) {
        console.error('Error fetching location from IP:', error);
        return { city: 'unknown', region: 'unknown', country: 'unknown' };
    }
}

// Route to retrieve aggregated page analytics
app.get('/api/aggregated-data', async (req, res) => {
    const { page, date } = req.query;

    try {
        const querySpec = {
            query: 'SELECT * FROM c WHERE c.page = @page AND c.date = @date',
            parameters: [
                { name: '@page', value: page },
                { name: '@date', value: date }
            ]
        };

        const { resources: aggregatedData } = await aggContainer.items.query(querySpec).fetchAll();

        let totalPageViews = 0;
        let totalDistinctUsers = 0;
        let totalNewUsers = 0;
        let totalCumulativeDailyDistinctUsers = 0;

        const hourlyData = Array(24).fill(null).map((_, hour) => ({
            hour,
            page_loads: 0,
            distinct_users: 0,
            new_users: 0,
            cumulative_daily_distinct_users: 0
        }));

        aggregatedData.forEach(item => {
            const hour = item.hour;

            hourlyData[hour].page_loads += item.page_loads || 0;
            hourlyData[hour].distinct_users += item.distinct_users || 0;
            hourlyData[hour].new_users += item.new_users || 0;
            hourlyData[hour].cumulative_daily_distinct_users += item.cumulative_daily_distinct_users || 0;

            totalPageViews += item.page_loads || 0;
            totalDistinctUsers += item.distinct_users || 0;
            totalNewUsers += item.new_users || 0;
            totalCumulativeDailyDistinctUsers += item.cumulative_daily_distinct_users || 0;
        });

        res.status(200).json({
            totalPageViews,
            totalDistinctUsers,
            totalNewUsers,
            totalCumulativeDailyDistinctUsers,
            aggregatedHourlyData: hourlyData
        });
    } catch (error) {
        console.error('Error querying aggregated data from Cosmos DB:', error);
        res.status(500).json({ error: 'Failed to retrieve aggregated data' });
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
